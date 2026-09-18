import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { toast } from "react-hot-toast";
import { api } from "../services/api";

const CODING_LANGS = [
  { value: "python", label: "Python" },
  { value: "java", label: "Java" },
  { value: "javascript", label: "JavaScript (Node)" },
];

export default function TestBuilder() {
  const { testId } = useParams();
  const navigate = useNavigate();
  const isNew = testId === "new";
  const editing = !isNew;

  const [batches, setBatches] = useState([]);
  const [test, setTest] = useState({
    title: "",
    description: "",
    batchId: "",
    availableFrom: "",
    availableUntil: "",
    durationMinutes: 60,
    allowLateStart: true,
    allowRankView: false,
  });
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showQuestion, setShowQuestion] = useState(false);
  const [questionType, setQuestionType] = useState("mcq");
  const [langOptions, setLangOptions] = useState(CODING_LANGS);

  // MCQ draft
  const [mcqDraft, setMcqDraft] = useState({
    questionText: "",
    options: [{ id: "a", text: "" }, { id: "b", text: "" }],
    correctAnswer: "",
    marks: 2,
    negativeMarks: 0,
  });

  // Coding draft
  const [codingDraft, setCodingDraft] = useState({
    questionText: "",
    language: "python",
    starterCode: "",
    complexityRequirement: "",
    inputConstraints: "",
    bannedPatterns: "",
    restrictMsg: "",
    timeLimitMs: 2000,
    memoryLimitMb: 256,
    sampleTestCases: [{ input: "", output: "" }],
    hiddenTestCases: [{ input: "", output: "", weight: 1 }],
    markingMode: "partial",
  });

  useEffect(() => {
    loadBatches();
    if (editing) loadTest();
    fetchCodingRuntimes();
  }, []);

  // Hide languages whose runtime isn't available on the connected server
  // (e.g. Java when the server judge reports java:false). Falls back to
  // showing all languages if /health can't be reached.
  async function fetchCodingRuntimes() {
    try {
      const res = await api.get("/health", { timeout: 8000 });
      const rt = res.data?.judge?.runtimes || {};
      const available = CODING_LANGS.filter((l) => rt[l.value] !== false);
      if (available.length > 0) setLangOptions(available);
    } catch {
      // keep default list
    }
  }

  async function loadBatches() {
    try {
      const res = await api.get("/admin/batches");
      setBatches(res.data.batches);
    } catch {
      toast.error("Failed to load batches");
    }
  }

  async function loadTest() {
    try {
      const res = await api.get(`/admin/tests/${testId}`);
      const t = res.data.test;
      setTest({
        title: t.title,
        description: t.description || "",
        batchId: String(t.batch_id),
        availableFrom: toLocalInput(t.available_from),
        availableUntil: toLocalInput(t.available_until),
        durationMinutes: t.duration_minutes,
        allowLateStart: t.allow_late_start,
        allowRankView: t.allow_rank_view,
      });
      setQuestions(res.data.questions);
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to load test");
    }
  }

  function toLocalInput(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function formatDate(iso) {
    return iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
  }

  async function saveTest() {
    if (!test.title.trim() || !test.batchId || !test.availableFrom || !test.availableUntil) {
      return toast.error("Fill title, batch, start & end time");
    }
    // Send explicit UTC instants so the wall-clock time the admin picked is
    // preserved regardless of the server's timezone (Render runs in UTC).
    const payload = {
      ...test,
      availableFrom: new Date(test.availableFrom).toISOString(),
      availableUntil: new Date(test.availableUntil).toISOString(),
    };
    setLoading(true);
    try {
      if (isNew) {
        const res = await api.post("/admin/tests", payload);
        toast.success("Test created. Add questions next.");
        navigate(`/admin/test/${res.data.test.id}`);
      } else {
        await api.patch(`/admin/tests/${testId}`, payload);
        toast.success("Test updated");
      }
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to save test");
    } finally {
      setLoading(false);
    }
  }

  // ===== MCQ =====
  function addMcqOption() {
    if (mcqDraft.options.length >= 6) return;
    const letters = "abcdefghij".split("");
    const nextId = letters[mcqDraft.options.length];
    setMcqDraft({ ...mcqDraft, options: [...mcqDraft.options, { id: nextId, text: "" }] });
  }

  async function saveMcq() {
    if (!mcqDraft.questionText.trim()) return toast.error("Enter question text");
    const filled = mcqDraft.options.filter((o) => o.text.trim());
    if (filled.length < 2) return toast.error("Need at least 2 options");
    if (!mcqDraft.correctAnswer) return toast.error("Select the correct answer");
    if (isNew) return toast.error("Save test settings first, then add questions");
    try {
      await api.post(`/admin/tests/${testId}/questions`, {
        type: "mcq",
        questionText: mcqDraft.questionText,
        options: filled,
        correctAnswer: mcqDraft.correctAnswer,
        marks: Number(mcqDraft.marks) || 1,
        negativeMarks: Number(mcqDraft.negativeMarks) || 0,
      });
      toast.success("MCQ added");
      setMcqDraft({ questionText: "", options: [{ id: "a", text: "" }, { id: "b", text: "" }], correctAnswer: "", marks: 2, negativeMarks: 0 });
      setShowQuestion(false);
      loadTest();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to add MCQ");
    }
  }

  // ===== Coding =====
  function addSampleCase() {
    setCodingDraft({
      ...codingDraft,
      sampleTestCases: [
        ...codingDraft.sampleTestCases,
        { input: "", output: "" },
      ],
    });
  }

  function addHiddenCase() {
    setCodingDraft({
      ...codingDraft,
      hiddenTestCases: [
        ...codingDraft.hiddenTestCases,
        { input: "", output: "", weight: 1 },
      ],
    });
  }

  async function saveCoding() {
    if (!codingDraft.questionText.trim()) return toast.error("Enter question text");
    if (!codingDraft.language) return toast.error("Select a language");
    // Hidden cases only need an expected output to grade against — the input
    // may legitimately be empty (e.g. "print hello world" questions).
    const hiddenFilled = codingDraft.hiddenTestCases.filter((t) => t.output.trim() !== "");
    if (hiddenFilled.length === 0) return toast.error("At least one hidden test case with an expected output required");
    const sampleFilled = codingDraft.sampleTestCases.filter((t) => t.output.trim() !== "");

    const bannedList = codingDraft.bannedPatterns
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    if (isNew) return toast.error("Save test settings first, then add questions");
    try {
      await api.post(`/admin/tests/${testId}/questions`, {
        type: "coding",
        questionText: codingDraft.questionText,
        language: codingDraft.language,
        starterCode: codingDraft.starterCode,
        complexityRequirement: codingDraft.complexityRequirement,
        inputConstraints: codingDraft.inputConstraints,
        bannedPatterns: bannedList,
        restrictMsg: codingDraft.restrictMsg,
        timeLimitMs: Number(codingDraft.timeLimitMs) || 2000,
        memoryLimitMb: Number(codingDraft.memoryLimitMb) || 256,
        sampleTestCases: sampleFilled,
        hiddenTestCases: hiddenFilled,
        weights: hiddenFilled.map((t) => Number(t.weight) || 1),
        markingMode: codingDraft.markingMode,
      });
      toast.success("Coding question added");
      setCodingDraft({
        questionText: "",
        language: "python",
        starterCode: "",
        complexityRequirement: "",
        inputConstraints: "",
        bannedPatterns: "",
        restrictMsg: "",
        timeLimitMs: 2000,
        memoryLimitMb: 256,
        sampleTestCases: [{ input: "", output: "" }],
        hiddenTestCases: [{ input: "", output: "", weight: 1 }],
        markingMode: "partial",
      });
      setShowQuestion(false);
      loadTest();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to add coding question");
    }
  }

  async function deleteQuestion(qid) {
    if (!confirm("Delete this question?")) return;
    try {
      await api.delete(`/admin/questions/${qid}`);
      toast.success("Question deleted");
      loadTest();
    } catch (err) {
      toast.error("Failed to delete");
    }
  }

  return (
    <div style={styles.wrapper}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <Link to="/admin" style={styles.back}>← Admin</Link>
          <div style={styles.brand}>{editing ? "Edit Test" : "New Test"}</div>
        </div>
        <button className="btn btn-success" onClick={saveTest} disabled={loading}>
          {loading ? "Saving..." : "Save Test Settings"}
        </button>
      </header>

      <div style={styles.content}>
        {/* Test settings */}
        <div className="card mb-16">
          <h3 style={styles.sectionTitle}>Test Settings</h3>
          <div className="grid-2">
            <div className="form-row">
              <label className="label">Test title *</label>
              <input
                className="input"
                value={test.title}
                onChange={(e) => setTest({ ...test, title: e.target.value })}
                placeholder="e.g., DS Algo Weekly Test 4"
              />
            </div>
            <div className="form-row">
              <label className="label">Batch *</label>
              <select
                className="input"
                value={test.batchId}
                onChange={(e) => setTest({ ...test, batchId: e.target.value })}
              >
                <option value="">Select batch</option>
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label className="label">Available from (when students can see it) *</label>
              <input
                className="input"
                type="datetime-local"
                value={test.availableFrom}
                onChange={(e) => setTest({ ...test, availableFrom: e.target.value })}
              />
            </div>
            <div className="form-row">
              <label className="label">Available until (auto-submit deadline) *</label>
              <input
                className="input"
                type="datetime-local"
                value={test.availableUntil}
                onChange={(e) => setTest({ ...test, availableUntil: e.target.value })}
              />
            </div>
            <div className="form-row">
              <label className="label">Duration (minutes) *</label>
              <input
                className="input"
                type="number"
                min="1"
                value={test.durationMinutes}
                onChange={(e) => setTest({ ...test, durationMinutes: Number(e.target.value) })}
              />
            </div>
          </div>
          <p className="text-small text-muted mb-16">
            Students will only see this test starting at the "Available from" time. Answers auto-submit at "Available until".
          </p>
          <div className="flex gap-16">
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={test.allowLateStart}
                onChange={(e) => setTest({ ...test, allowLateStart: e.target.checked })}
              />
              Allow late start (reduced time)
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={test.allowRankView}
                onChange={(e) => setTest({ ...test, allowRankView: e.target.checked })}
              />
              Show batch rank to students
            </label>
          </div>
          <div className="form-row mt-16">
            <label className="label">Description</label>
            <textarea
              className="input"
              rows={2}
              value={test.description}
              onChange={(e) => setTest({ ...test, description: e.target.value })}
              placeholder="Optional description shown to students"
            />
          </div>
        </div>

        {/* Questions */}
        <div className="flex-between mb-16">
          <h3 style={styles.sectionTitle}>Questions ({questions.length})</h3>
          <button
            className="btn btn-primary"
            onClick={() => {
              if (isNew) return toast.error("Save test settings first, then add questions");
              setShowQuestion((v) => !v);
            }}
          >
            {showQuestion ? "Cancel" : "+ Add Question"}
          </button>
        </div>

        {/* Question type selector + form */}
        {showQuestion && (
          <div className="card mb-16">
            <div style={styles.typeTabs}>
              <button
                style={questionType === "mcq" ? styles.typeActive : styles.typeBtn}
                onClick={() => setQuestionType("mcq")}
              >
                MCQ
              </button>
              <button
                style={questionType === "coding" ? styles.typeActive : styles.typeBtn}
                onClick={() => setQuestionType("coding")}
              >
                Coding
              </button>
            </div>

            {/* MCQ form */}
            {questionType === "mcq" && (
              <div>
                <div className="form-row">
                  <label className="label">Question text *</label>
                  <textarea
                    className="input"
                    rows={3}
                    value={mcqDraft.questionText}
                    onChange={(e) => setMcqDraft({ ...mcqDraft, questionText: e.target.value })}
                  />
                </div>
                <div className="grid-2">
                  <div className="form-row">
                    <label className="label">Marks *</label>
                    <input
                      className="input"
                      type="number"
                      min="1"
                      value={mcqDraft.marks}
                      onChange={(e) => setMcqDraft({ ...mcqDraft, marks: Number(e.target.value) })}
                    />
                  </div>
                  <div className="form-row">
                    <label className="label">Negative marking (0 = none)</label>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      step="0.5"
                      value={mcqDraft.negativeMarks}
                      onChange={(e) => setMcqDraft({ ...mcqDraft, negativeMarks: Number(e.target.value) })}
                    />
                  </div>
                </div>

                <label className="label">Options</label>
                {mcqDraft.options.map((opt, i) => (
                  <div key={opt.id} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <button
                      onClick={() => setMcqDraft({ ...mcqDraft, correctAnswer: opt.id })}
                      style={{
                        width: 36,
                        height: 36,
                        border: mcqDraft.correctAnswer === opt.id ? "2px solid #10b981" : "1px solid #e2e8f0",
                        background: mcqDraft.correctAnswer === opt.id ? "#d1fae5" : "#fff",
                        borderRadius: 8,
                        cursor: "pointer",
                        fontWeight: 700,
                        fontSize: 12,
                        color: mcqDraft.correctAnswer === opt.id ? "#065f46" : "#64748b",
                      }}
                      title="Mark as correct answer"
                    >
                      {opt.id.toUpperCase()}
                    </button>
                    <input
                      className="input"
                      placeholder={`Option ${opt.id}`}
                      value={opt.text}
                      onChange={(e) => {
                        const newOpts = [...mcqDraft.options];
                        newOpts[i].text = e.target.value;
                        setMcqDraft({ ...mcqDraft, options: newOpts });
                      }}
                    />
                    {mcqDraft.options.length > 2 && (
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => {
                          const newOpts = mcqDraft.options.filter((_, idx) => idx !== i);
                          if (mcqDraft.correctAnswer === opt.id) setMcqDraft({ ...mcqDraft, options: newOpts, correctAnswer: "" });
                          else setMcqDraft({ ...mcqDraft, options: newOpts });
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                {mcqDraft.options.length < 6 && (
                  <button className="btn btn-sm btn-secondary" onClick={addMcqOption}>
                    + Add option
                  </button>
                )}
                <p className="text-small text-muted mt-8">
                  Click a letter button to mark the correct answer (green = correct).
                </p>
                <div className="mt-16">
                  <button className="btn btn-primary" onClick={saveMcq}>
                    Save MCQ
                  </button>
                </div>
              </div>
            )}

            {/* Coding form */}
            {questionType === "coding" && (
              <div>
                <div className="form-row">
                  <label className="label">Question text *</label>
                  <textarea
                    className="input"
                    rows={3}
                    value={codingDraft.questionText}
                    onChange={(e) => setCodingDraft({ ...codingDraft, questionText: e.target.value })}
                    placeholder="e.g., Given an array of integers, find the maximum subarray sum. Must run in O(n) time."
                  />
                </div>
                <div className="grid-3">
                  <div className="form-row">
                    <label className="label">Language *</label>
                    <select
                      className="input"
                      value={codingDraft.language}
                      onChange={(e) => setCodingDraft({ ...codingDraft, language: e.target.value })}
                    >
                      {langOptions.map((l) => (
                        <option key={l.value} value={l.value}>{l.label}</option>
                      ))}
                      {!langOptions.some((l) => l.value === codingDraft.language) && (
                        <option value={codingDraft.language}>
                          {CODING_LANGS.find((l) => l.value === codingDraft.language)?.label ||
                            codingDraft.language}{" "}
                          (unavailable on server)
                        </option>
                      )}
                    </select>
                    {!langOptions.some((l) => l.value === codingDraft.language) && (
                      <p className="text-muted">
                        The connected server cannot grade this language right now. Students
                        will only see supported languages in their test.
                      </p>
                    )}
                  </div>
                  <div className="form-row">
                    <label className="label">Time limit (ms)</label>
                    <input
                      className="input"
                      type="number"
                      min="100"
                      step="100"
                      value={codingDraft.timeLimitMs}
                      onChange={(e) => setCodingDraft({ ...codingDraft, timeLimitMs: Number(e.target.value) })}
                    />
                  </div>
                  <div className="form-row">
                    <label className="label">Memory limit (MB)</label>
                    <input
                      className="input"
                      type="number"
                      min="16"
                      value={codingDraft.memoryLimitMb}
                      onChange={(e) => setCodingDraft({ ...codingDraft, memoryLimitMb: Number(e.target.value) })}
                    />
                  </div>
                </div>

                <div className="grid-2">
                  <div className="form-row">
                    <label className="label">Complexity requirement (shown to student)</label>
                    <textarea
                      className="input"
                      rows={2}
                      value={codingDraft.complexityRequirement}
                      onChange={(e) => setCodingDraft({ ...codingDraft, complexityRequirement: e.target.value })}
                      placeholder={"e.g., O(n) time, O(1) space\nMust not be O(n^2)"}
                    />
                  </div>
                  <div className="form-row">
                    <label className="label">Input constraints (shown to student)</label>
                    <textarea
                      className="input"
                      rows={2}
                      value={codingDraft.inputConstraints}
                      onChange={(e) => setCodingDraft({ ...codingDraft, inputConstraints: e.target.value })}
                      placeholder={"e.g., 1 ≤ n ≤ 10^5\n1 ≤ arr[i] ≤ 10^9"}
                    />
                  </div>
                </div>

                <div className="form-row">
                  <label className="label">
                    Banned code patterns (one per line — literal or regex){" "}
                    <span className="text-muted">violation = automatic 0</span>
                  </label>
                  <textarea
                    className="input"
                    rows={3}
                    value={codingDraft.bannedPatterns}
                    onChange={(e) => setCodingDraft({ ...codingDraft, bannedPatterns: e.target.value })}
                    placeholder={"import os\nsubprocess\neval(\nexec("}
                  />
                </div>
                <div className="form-row">
                  <label className="label">Restriction message (shown to student)</label>
                  <input
                    className="input"
                    value={codingDraft.restrictMsg}
                    onChange={(e) => setCodingDraft({ ...codingDraft, restrictMsg: e.target.value })}
                    placeholder="e.g., Do not use multiplication (/), division (*), or modulo (%) operators"
                  />
                </div>

                <div className="form-row">
                  <label className="label">Starter code (optional)</label>
                  <textarea
                    className="input"
                    rows={4}
                    style={{ fontFamily: "monospace", fontSize: 13 }}
                    value={codingDraft.starterCode}
                    onChange={(e) => setCodingDraft({ ...codingDraft, starterCode: e.target.value })}
                    placeholder={"def maximumSubarray(nums):\n    # write your code here\n    pass"}
                  />
                </div>

                <div className="form-row">
                  <label className="label">Marking mode</label>
                  <select
                    className="input"
                    style={{ maxWidth: 260 }}
                    value={codingDraft.markingMode}
                    onChange={(e) => setCodingDraft({ ...codingDraft, markingMode: e.target.value })}
                  >
                    <option value="partial">Partial credit (marks per passing test case)</option>
                    <option value="all_or_nothing">All or nothing (must pass every case)</option>
                  </select>
                </div>

                {/* Sample test cases */}
                <div className="form-row">
                  <div className="flex-between mb-8">
                    <label className="label" style={{ marginBottom: 0 }}>
                      Sample test cases (student can see & run these)
                    </label>
                    <button className="btn btn-sm btn-secondary" onClick={addSampleCase}>
                      + Add
                    </button>
                  </div>
                  {codingDraft.sampleTestCases.map((tc, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                      <span className="text-muted text-small" style={{ width: 40 }}>
                        #{i + 1}
                      </span>
                      <input
                        className="input"
                        placeholder="Input"
                        style={{ flex: 1 }}
                        value={tc.input}
                        onChange={(e) => {
                          const arr = [...codingDraft.sampleTestCases];
                          arr[i].input = e.target.value;
                          setCodingDraft({ ...codingDraft, sampleTestCases: arr });
                        }}
                      />
                      <input
                        className="input"
                        placeholder="Output"
                        style={{ flex: 1 }}
                        value={tc.output}
                        onChange={(e) => {
                          const arr = [...codingDraft.sampleTestCases];
                          arr[i].output = e.target.value;
                          setCodingDraft({ ...codingDraft, sampleTestCases: arr });
                        }}
                      />
                      {codingDraft.sampleTestCases.length > 1 && (
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() =>
                            setCodingDraft({
                              ...codingDraft,
                              sampleTestCases: codingDraft.sampleTestCases.filter((_, idx) => idx !== i),
                            })
                          }
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Hidden test cases with weights */}
                <div className="form-row">
                  <div className="flex-between mb-8">
                    <label className="label" style={{ marginBottom: 0 }}>
                      Hidden test cases (grading only — student NEVER sees these){" "}
                      <span className="text-muted">· brute-force killers live here</span>
                    </label>
                    <button className="btn btn-sm btn-secondary" onClick={addHiddenCase}>
                      + Add
                    </button>
                  </div>
                  {codingDraft.hiddenTestCases.map((tc, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        gap: 8,
                        marginBottom: 8,
                        alignItems: "center",
                        background: "#fefce8",
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "1px solid #fde68a",
                      }}
                    >
                      <span className="text-muted text-small" style={{ width: 40 }}>
                        #{i + 1}
                      </span>
                      <input
                        className="input"
                        placeholder="Input (large values kill brute force)"
                        style={{ flex: 2 }}
                        value={tc.input}
                        onChange={(e) => {
                          const arr = [...codingDraft.hiddenTestCases];
                          arr[i].input = e.target.value;
                          setCodingDraft({ ...codingDraft, hiddenTestCases: arr });
                        }}
                      />
                      <input
                        className="input"
                        placeholder="Output"
                        style={{ flex: 2 }}
                        value={tc.output}
                        onChange={(e) => {
                          const arr = [...codingDraft.hiddenTestCases];
                          arr[i].output = e.target.value;
                          setCodingDraft({ ...codingDraft, hiddenTestCases: arr });
                        }}
                      />
                      <input
                        className="input"
                        type="number"
                        min="1"
                        placeholder="Marks"
                        style={{ width: 80 }}
                        value={tc.weight}
                        onChange={(e) => {
                          const arr = [...codingDraft.hiddenTestCases];
                          arr[i].weight = e.target.value;
                          setCodingDraft({ ...codingDraft, hiddenTestCases: arr });
                        }}
                      />
                      {codingDraft.hiddenTestCases.length > 1 && (
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() =>
                            setCodingDraft({
                              ...codingDraft,
                              hiddenTestCases: codingDraft.hiddenTestCases.filter((_, idx) => idx !== i),
                            })
                          }
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                  <p className="text-small text-muted mt-8">
                    Total marks:{" "}
                    <b>
                      {codingDraft.hiddenTestCases
                        .reduce((sum, t) => sum + (Number(t.weight) || 0), 0)}
                    </b>
                    {" "}· Marks are earned per passing case (partial mode). Large hidden
                    inputs with a tight time limit force the intended algorithm.
                  </p>
                </div>

                <button className="btn btn-primary" onClick={saveCoding}>
                  Save Coding Question
                </button>
              </div>
            )}
          </div>
        )}

        {/* Questions list */}
        {questions.length > 0 ? (
          <div className="card">
            <h4 className="mb-16">Added Questions</h4>
            {questions.map((q, i) => {
              if (q.type === "mcq") {
                return (
                  <div key={q.id} style={styles.qRow}>
                    <div style={styles.qNum}>{i + 1}</div>
                    <div style={{ flex: 1 }}>
                      <span className="badge badge-info">MCQ</span>{" "}
                      <span style={styles.qTitle}>{q.question_text}</span>
                      <div className="text-small text-muted mt-8">
                        {q.options?.length} options · {q.marks} marks
                        {q.negative_marks > 0 && ` · -${q.negative_marks} if wrong`}
                      </div>
                    </div>
                    <button className="btn btn-sm btn-danger" onClick={() => deleteQuestion(q.id)}>
                      ✕
                    </button>
                  </div>
                );
              }
              const hiddenCount = q.hidden_test_cases?.length || 0;
              const totalWeight = q.hidden_test_cases?.reduce((s, t) => s + (Number(t.weight) || 1), 0) || q.marks;
              return (
                <div key={q.id} style={styles.qRow}>
                  <div style={styles.qNum}>{i + 1}</div>
                  <div style={{ flex: 1 }}>
                    <span className="badge" style={{ background: "#e0e7ff", color: "#3730a3" }}>
                      CODING · {q.language}
                    </span>{" "}
                    <span style={styles.qTitle}>{q.question_text}</span>
                    <div className="text-small text-muted mt-8">
                      {hiddenCount} hidden cases · {totalWeight} pts total ·{" "}
                      {(q.time_limit_ms / 1000).toFixed(1)}s · {q.memory_limit_mb}MB ·{" "}
                      {q.marking_mode === "partial" ? "partial" : "all-or-nothing"}
                      {q.banned_patterns?.length > 0 && ` · ⚠ ${q.banned_patterns.length} banned pattern(s)`}
                    </div>
                  </div>
                  <button className="btn btn-sm btn-danger" onClick={() => deleteQuestion(q.id)}>
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="card" style={{ textAlign: "center", padding: 24 }}>
            <p className="text-muted">
              No questions yet. Add MCQ or coding questions.
              {editing && " Remember to save test settings after changes."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  wrapper: { height: "100vh", display: "flex", flexDirection: "column" },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "16px 24px",
    background: "#fff",
    borderBottom: "1px solid #e2e8f0",
  },
  headerLeft: { display: "flex", alignItems: "center", gap: 16 },
  back: { color: "#4f46e5", textDecoration: "none", fontSize: 14 },
  brand: { fontSize: 18, fontWeight: 700 },
  content: { flex: 1, overflowY: "auto", padding: 24, maxWidth: 900, width: "100%", margin: "0 auto" },
  sectionTitle: { fontSize: 18, fontWeight: 600, marginBottom: 16 },
  typeTabs: { display: "flex", gap: 8, marginBottom: 20 },
  typeBtn: {
    padding: "8px 20px",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    background: "#fff",
    cursor: "pointer",
    fontSize: 14,
    color: "#64748b",
  },
  typeActive: {
    padding: "8px 20px",
    border: "1px solid #4f46e5",
    borderRadius: 8,
    background: "#eef2ff",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 600,
    color: "#4f46e5",
  },
  qRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "14px 0",
    borderBottom: "1px solid #f1f5f9",
  },
  qNum: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    background: "#f1f5f9",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
    fontSize: 13,
  },
  qTitle: { marginLeft: 8, fontWeight: 500 },
};