import React, { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import Editor from "@monaco-editor/react";
import { api } from "../services/api";
import { decrypt, decryptJson } from "../services/crypto";
import {
  storeData,
  getData,
  saveExamDraft,
  getExamDraft,
  clearExamDraft,
  queueSubmission,
} from "../services/offline";
import { useAuth } from "../services/auth.jsx";

const LANGUAGE_MAP = {
  python: "python",
  java: "java",
  javascript: "javascript",
};

export default function ExamPortal() {
  const { user } = useAuth();
  const { testId } = useParams();
  const navigate = useNavigate();

  // State
  const [phase, setPhase] = useState("intro"); // intro | running | submitting | submitted
  const [test, setTest] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [weights, setWeights] = useState({});
  const [answers, setAnswers] = useState({}); // { questionId: { type, answer/code } }
  const [currentIndex, setCurrentIndex] = useState(0);
  const [remainingMs, setRemainingMs] = useState(0);
  const [tabSwitches, setTabSwitches] = useState(0);
  const [runningOutput, setRunningOutput] = useState({});
  const [isRunning, setIsRunning] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [decrypted, setDecrypted] = useState([]);

  const timerRef = useRef(null);
  const examKeyRef = useRef(null);
  const startedAtRef = useRef(null);
  const runtimeKeyRef = useRef(null);

  // ===== Phase 1: start test =====
  async function startExam() {
    setPhase("entering");
    try {
      const res = await api.post(`/student/tests/${testId}/start`);
      const data = res.data;

      examKeyRef.current = data.encryptionKey;
      testMetaRef = data.test;
      startedAtRef.current = new Date(data.submission.startedAt);

      // Decrypt questions into memory (NOT persisted)
      const decryptedQuestions = data.questions.map((q) => {
        if (q.type === "mcq") {
          return {
            ...q,
            question_text: decrypt(q.question_text, data.encryptionKey),
            options: decryptJson(q.options, data.encryptionKey) || [],
            correct_answer: decrypt(q.correct_answer, data.encryptionKey),
          };
        }
        return {
          ...q,
          question_text: decrypt(q.question_text, data.encryptionKey),
          starter_code: decrypt(q.starter_code, data.encryptionKey) || "",
          sample_test_cases:
            decryptJson(q.sample_test_cases, data.encryptionKey) || [],
        };
      });

      setTest(data.test);
      setQuestions(decryptedQuestions);
      setWeights(data.weights || {});
      setRemainingMs(data.submission.remainingMs);
      setDecrypted(decryptedQuestions);

      // Restore draft if any
      const draft = await getExamDraft(testId);
      if (draft) {
        setAnswers(draft.answers || {});
        setTabSwitches(draft.tabSwitches || 0);
        // Restore remaining time from draft if we were in-progress
        if (draft.remainingMs) setRemainingMs(draft.remainingMs);
        toast("Restored your in-progress answers");
      } else {
        // Initialize starter code for coding questions
        const initial = {};
        decryptedQuestions.forEach((q) => {
          if (q.type === "coding") {
            initial[q.id] = { type: "coding", code: q.starter_code || "" };
          }
        });
        setAnswers(initial);
      }

      // Enter exam mode (fullscreen + keyboard lock)
      if (window.electronAPI) {
        await window.electronAPI.enterFullscreen();
        await window.electronAPI.setExamMode(true);
      }
      document.body.classList.add("exam-active", "no-select");

      setPhase("running");
      setOffline(!navigator.onLine);

      // Window blur = tab switch
      window.addEventListener("blur", handleTabSwitch);
      window.onbeforeunload = handleBeforeUnload;
    } catch (err) {
      const msg = err.response?.data?.error || "Failed to start test";
      toast.error(msg);
      setPhase("intro");
      navigate("/student");
    }
  }

  let testMetaRef = null;

  const handleTabSwitch = useCallback(() => {
    setTabSwitches((n) => {
      const next = n + 1;
      if (next >= 5) {
        toast.error("Warning: leaving the exam window is logged.", { duration: 4000 });
      }
      return next;
    });
  }, []);

  const handleBeforeUnload = useCallback((e) => {
    const draft = {
      answers,
      tabSwitches,
      remainingMs: remainingMs,
      testId,
    };
    saveExamDraft(testId, draft);
    e.preventDefault();
    e.returnValue = "Your progress is saved. Are you sure you want to leave?";
    return e.returnValue;
  }, [answers, tabSwitches, remainingMs, testId]);

  // ===== Timer =====
  useEffect(() => {
    if (phase !== "running") return;
    timerRef.current = setInterval(() => {
      setRemainingMs((ms) => {
        const next = ms - 1000;
        if (next <= 0) {
          clearInterval(timerRef.current);
          // Auto-submit
          submitExam("timeout");
          return 0;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [phase]);

  // Save draft periodically
  useEffect(() => {
    if (phase !== "running") return;
    const autoSave = setInterval(() => {
      saveExamDraft(testId, { answers, tabSwitches, remainingMs, testId });
    }, 30000);
    return () => clearInterval(autoSave);
  }, [phase, answers, tabSwitches, remainingMs, testId]);

  // Online/offline detection
  useEffect(() => {
    const onOnline = () => {
      setOffline(false);
      toast.success("Back online — answers will sync");
    };
    const onOffline = () => {
      setOffline(true);
      toast("You're offline. Test continues — answers saved locally.", {
        duration: 5000,
      });
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  // ===== Answer handling =====
  function setAnswer(qid, value) {
    setAnswers((prev) => ({
      ...prev,
      [qid]: typeof value === "object" ? value : { answer: value },
    }));
  }

  function setCode(qid, code) {
    setAnswers((prev) => ({ ...prev, [qid]: { type: "coding", code } }));
  }

  // ===== Run code (sample cases) =====
  async function runCode(qid) {
    const q = decrypted.find((x) => x.id === qid);
    if (!q || q.type !== "coding") return;
    const code = answers[qid]?.code;
    if (!code) {
      toast.error("Write some code first");
      return;
    }
    setIsRunning(true);
    try {
      const results = [];
      for (const tc of q.sample_test_cases) {
        try {
          const runRes = await api.post("/student/code/run", {
            language: q.language,
            code,
            stdin: tc.input,
            testId,
            questionId: qid,
          });
          results.push({
            input: tc.input,
            expected: tc.output,
            actual: runRes.data.stdout || runRes.data.stderr || runRes.data.compileOutput || "",
            status: runRes.data.statusDescription || "Done",
            code: runRes.data.status === 3 ? 0 : 1,
          });
        } catch (err) {
          results.push({
            input: tc.input,
            expected: tc.output,
            actual: err.response?.data?.error || "Failed to run",
            status: "Error",
            code: -1,
          });
        }
      }
      setRunningOutput({ ...runningOutput, [qid]: results });
    } finally {
      setIsRunning(false);
    }
  }

  // ===== Submit =====
  async function submitExam(reason = "manual") {
    if (phase === "submitting" || phase === "submitted") return;
    setPhase("submitting");

    const answerList = Object.entries(answers).map(([qid, val]) => ({
      questionId: Number(qid),
      ...val,
    }));

    const payload = {
      answers: answerList,
      tabSwitches,
    };

    // Exit exam mode before showing result (fullscreen off)
    try {
      if (window.electronAPI) {
        await window.electronAPI.setExamMode(false);
        await window.electronAPI.exitFullscreen();
      }
    } catch {}

    document.body.classList.remove("exam-active", "no-select");
    clearInterval(timerRef.current);

    try {
      const res = await api.post(`/student/tests/${testId}/submit`, payload);
      await clearExamDraft(testId);
      setSubmitResult(res.data);
      setPhase("submitted");
      toast.success(res.data.message || "Submitted!");
    } catch (err) {
      // Offline or network fail: queue submission for sync
      await queueSubmission({
        testId,
        payload,
        submittedAt: new Date().toISOString(),
      });
      setSubmitResult({
        score: null,
        offlineQueued: true,
        message: "No connection — your submission is saved and will sync automatically.",
      });
      setPhase("submitted");
    }
  }

  // ===== UI helpers =====
  function formatTime(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${h.toString().padStart(2, "0")}:${m
      .toString()
      .padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }

  const currentQ = decrypted[currentIndex];

  // ===== Render =====

  if (phase === "intro") {
    const meta = testMetaRef || {};
    return (
      <div style={styles.centerPage}>
        <div className="card" style={{ maxWidth: 460, width: "100%" }}>
          <h2 style={{ marginBottom: 12 }}>Ready to start?</h2>
          <p className="text-muted" style={{ marginBottom: 20 }}>
            Once you begin, the app locks into fullscreen. Leaving the exam window
            is tracked. Your answers are saved locally and sync automatically —
            a weak connection won't disrupt your test.
          </p>
          <ul style={styles.ruleList}>
            <li>Fullscreen mode is enforced</li>
            <li>Copy/paste is disabled during the exam</li>
            <li>Tab-switching is logged</li>
            <li>Auto-submit happens when time runs out</li>
          </ul>
          <button className="btn btn-primary" style={{ width: "100%" }} onClick={startExam}>
            Start Exam
          </button>
          <button
            className="btn btn-secondary"
            style={{ width: "100%", marginTop: 8 }}
            onClick={() => navigate("/student")}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (phase === "entering") {
    return (
      <div style={styles.centerPage}>
        <div className="card">
          <p className="text-muted">Starting exam...</p>
        </div>
      </div>
    );
  }

  if (phase === "submitted") {
    return (
      <div style={styles.centerPage}>
        <div className="card" style={{ maxWidth: 520, width: "100%" }}>
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                background: submitResult?.offlineQueued ? "#fef3c7" : "#d1fae5",
                color: submitResult?.offlineQueued ? "#92400e" : "#065f46",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 32,
                margin: "0 auto 12px",
              }}
            >
              {submitResult?.offlineQueued ? "!" : "✓"}
            </div>
            <h2 style={{ fontSize: 22 }}>
              {submitResult?.offlineQueued ? "Saved offline" : "Test submitted!"}
            </h2>
            <p className="text-muted mt-8">
              {submitResult?.message ||
                "Your answers were submitted successfully."}
            </p>
            {submitResult?.score != null && !submitResult?.offlineQueued && (
              <p style={{ marginTop: 16, fontSize: 20 }}>
                Your score:{" "}
                <b style={{ color: "#4f46e5" }}>
                  {submitResult.score} / {submitResult.totalMarks}
                </b>
              </p>
            )}
          </div>
          <button
            className="btn btn-primary"
            style={{ width: "100%" }}
            onClick={() => navigate("/student")}
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // Running state
  return (
    <div style={styles.examShell}>
      {/* Top bar: timer + status */}
      <div style={styles.topBar}>
        <div style={styles.examTitle}>{test?.title}</div>
        <div style={styles.timerArea}>
          {offline && <span className="badge badge-warning" style={{ marginRight: 12 }}>OFFLINE</span>}
          <span
            className="badge"
            style={{
              ...styles.timer,
              ...(remainingMs < 5 * 60 * 1000
                ? { background: "#fee2e2", color: "#991b1b" }
                : { background: "#d1fae5", color: "#065f46" }),
            }}
          >
            ⏱ {formatTime(remainingMs)}
          </span>
          <span className="text-small text-muted" style={{ marginLeft: 12 }}>
            Tab switches: {tabSwitches}
          </span>
        </div>
      </div>

      <div style={styles.examBody}>
        {/* Question navigator */}
        <div style={styles.sidebar}>
          <div style={styles.qnavigator}>
            {decrypted.map((q, i) => {
              const answered =
                q.type === "mcq"
                  ? answers[q.id]?.answer
                  : answers[q.id]?.code?.trim();
              return (
                <button
                  key={q.id}
                  onClick={() => setCurrentIndex(i)}
                  style={{
                    ...styles.qnavBtn,
                    background: i === currentIndex ? "#4f46e5" : answered ? "#d1fae5" : "#e2e8f0",
                    color: i === currentIndex ? "#fff" : answered ? "#065f46" : "#475569",
                  }}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
          <div style={styles.sidebarFooter}>
            <button
              className="btn btn-danger"
              style={{ width: "100%" }}
              onClick={() => {
                if (confirm("Submit your exam now?")) submitExam("manual");
              }}
            >
              Submit Exam
            </button>
            <p className="text-small text-muted text-center" style={{ marginTop: 8 }}>
              Unanswered questions are marked automatically.
            </p>
          </div>
        </div>

        {/* Question area */}
        <div style={styles.questionArea}>
          {currentQ && currentQ.type === "mcq" && (
            <div key={currentQ.id} style={styles.mcqPanel}>
              <div style={styles.qHeader}>
                <span className="badge badge-info">MCQ · {currentQ.marks} marks</span>
                {currentQ.negative_marks > 0 && (
                  <span className="badge badge-warning">
                    -{currentQ.negative_marks} if wrong
                  </span>
                )}
              </div>
              <h3 style={styles.qText}>{currentQ.question_text}</h3>
              <div style={styles.options}>
                {currentQ.options?.map((opt) => {
                  const selected = answers[currentQ.id]?.answer === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => setAnswer(currentQ.id, opt.id)}
                      style={{
                        ...styles.optionBtn,
                        ...(selected ? styles.optionSelected : {}),
                      }}
                    >
                      <span style={styles.optionLetter}>{opt.id.toUpperCase()}</span>
                      {opt.text}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {currentQ && currentQ.type === "coding" && (
            <div key={currentQ.id} style={styles.codingPanel}>
              <div style={styles.qHeader}>
                <span className="badge" style={{ background: "#e0e7ff", color: "#3730a3" }}>
                  CODING · {LANGUAGE_MAP[currentQ.language] || currentQ.language}
                </span>
                <span className="text-muted text-small">
                  {currentQ.marks} marks · max{" "}
                  {(currentQ.time_limit_ms / 1000).toFixed(1)}s ·{" "}
                  {currentQ.memory_limit_mb}MB
                </span>
              </div>

              <h3 style={styles.qText}>{currentQ.question_text}</h3>

              {(currentQ.complexity_requirement || currentQ.input_constraints) && (
                <div style={styles.constraintsBox}>
                  {currentQ.complexity_requirement && (
                    <p>
                      <b>Complexity:</b> {currentQ.complexity_requirement}
                    </p>
                  )}
                  {currentQ.input_constraints && (
                    <p>
                      <b>Input:</b> {currentQ.input_constraints}
                    </p>
                  )}
                  {currentQ.restrict_msg && (
                    <p style={{ color: "#dc2626" }}>
                      <b>Restriction:</b> {currentQ.restrict_msg}
                    </p>
                  )}
                </div>
              )}

              {/* Sample cases */}
              {currentQ.sample_test_cases?.length > 0 && (
                <div style={styles.samplesBox}>
                  <b className="text-small">Sample test cases:</b>
                  {currentQ.sample_test_cases.map((tc, i) => (
                    <div key={i} className="text-small" style={styles.sampleRow}>
                      <code>Input: {tc.input}</code> → <code>Output: {tc.output}</code>
                    </div>
                  ))}
                </div>
              )}

              {/* Editor */}
              <div style={styles.editorBox}>
                <div style={styles.editorToolbar}>
                  <span className="text-small text-muted">
                    {LANGUAGE_MAP[currentQ.language] || currentQ.language}
                  </span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() => runCode(currentQ.id)}
                      disabled={isRunning}
                    >
                      {isRunning ? "Running..." : "▶ Run"}
                    </button>
                  </div>
                </div>
                <Editor
                  height="45vh"
                  language={LANGUAGE_MAP[currentQ.language] || "plaintext"}
                  theme="vs-dark"
                  value={answers[currentQ.id]?.code || ""}
                  onChange={(val) => setCode(currentQ.id, val || "")}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 14,
                    scrollBeyondLastLine: false,
                    wordWrap: "on",
                    automaticLayout: true,
                    // Anti-cheat: disable copy/paste in editor
                    contextmenu: false,
                  }}
                />
              </div>

              {/* Output */}
              {runningOutput[currentQ.id] && (
                <div style={styles.outputBox}>
                  {runningOutput[currentQ.id].map((r, i) => (
                    <div key={i} style={styles.outputRow}>
                      <div className="text-small text-muted">
                        Test {i + 1} — Input: <code>{r.input}</code>
                      </div>
                      <div
                        style={{
                          color: r.status === "Accepted" ? "#059669" : "#dc2626",
                        }}
                      >
                        {r.status === "Accepted" ? (
                          r.actual.trim() === r.expected.trim() ? (
                            "✓ Passed"
                          ) : (
                            "✗ Wrong output"
                          )
                        ) : (
                          r.status
                        )}
                      </div>
                      <pre
                        style={{
                          background: "#f8fafc",
                          padding: 8,
                          borderRadius: 6,
                          fontSize: 12,
                          marginTop: 4,
                        }}
                      >
                        Expected: {r.expected}
                        {"\n"}Got: {r.actual}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Nav buttons */}
          <div style={styles.navButtons}>
            <button
              className="btn btn-secondary"
              disabled={currentIndex === 0}
              onClick={() => setCurrentIndex((i) => i - 1)}
            >
              ← Previous
            </button>
            {currentIndex < decrypted.length - 1 ? (
              <button
                className="btn btn-primary"
                onClick={() => setCurrentIndex((i) => i + 1)}
              >
                Next →
              </button>
            ) : (
              <button
                className="btn btn-success"
                onClick={() => {
                  if (confirm("Submit your exam now?")) submitExam("manual");
                }}
              >
                Submit All
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  centerPage: {
    height: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    background: "#f8fafc",
  },
  ruleList: {
    marginLeft: 18,
    marginBottom: 20,
    color: "#475569",
    fontSize: 13,
    lineHeight: 1.8,
  },
  examShell: {
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    background: "#f8fafc",
  },
  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 20px",
    background: "#1e293b",
    color: "#fff",
  },
  examTitle: { fontSize: 16, fontWeight: 600 },
  timerArea: { display: "flex", alignItems: "center" },
  timer: { fontSize: 15, padding: "4px 14px", fontWeight: 600 },
  examBody: { flex: 1, display: "flex", flexDirection: "row", overflow: "hidden" },
  sidebar: {
    width: 140,
    background: "#fff",
    borderRight: "1px solid #e2e8f0",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    padding: 16,
  },
  qnavigator: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 },
  qnavBtn: {
    width: 32,
    height: 32,
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 13,
  },
  sidebarFooter: {},
  questionArea: {
    flex: 1,
    overflowY: "auto",
    padding: 24,
    paddingBottom: 32,
  },
  mcqPanel: { maxWidth: 800 },
  qHeader: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  qText: { fontSize: 18, marginBottom: 24, lineHeight: 1.5 },
  options: { display: "flex", flexDirection: "column", gap: 12 },
  optionBtn: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "14px 18px",
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    background: "#fff",
    cursor: "pointer",
    fontSize: 14,
    textAlign: "left",
    transition: "all 0.15s ease",
    color: "#1e293b",
  },
  optionSelected: {
    borderColor: "#4f46e5",
    background: "#eef2ff",
    boxShadow: "0 0 0 2px rgba(79,70,229,0.15)",
  },
  optionLetter: {
    width: 28,
    height: 28,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "50%",
    background: "#e2e8f0",
    fontWeight: 700,
    fontSize: 13,
  },
  codingPanel: {},
  constraintsBox: {
    background: "#fefce8",
    borderLeft: "3px solid #eab308",
    padding: "12px 16px",
    borderRadius: "0 8px 8px 0",
    marginBottom: 16,
    fontSize: 13,
    lineHeight: 1.7,
  },
  samplesBox: {
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    padding: "12px 16px",
    marginBottom: 16,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  sampleRow: { fontFamily: "monospace" },
  editorBox: {
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    overflow: "hidden",
    background: "#fff",
    marginBottom: 16,
  },
  editorToolbar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 12px",
    background: "#f8fafc",
    borderBottom: "1px solid #e2e8f0",
  },
  outputBox: {
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    padding: 16,
    marginBottom: 16,
  },
  outputRow: {
    padding: "8px 0",
    borderBottom: "1px solid #f1f5f9",
    fontSize: 13,
  },
  navButtons: {
    display: "flex",
    justifyContent: "space-between",
    marginTop: 24,
    maxWidth: 800,
  },
};