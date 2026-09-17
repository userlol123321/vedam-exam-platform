import React, { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { toast } from "react-hot-toast";
import { api } from "../services/api";
import { useAuth } from "../services/auth.jsx";
import { initials } from "../utils/branding";

export default function StudentResults() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    loadResults();
  }, []);

  async function loadResults() {
    try {
      const res = await api.get("/student/results");
      setResults(res.data.results);
      localStorage.setItem("vedam_results", JSON.stringify(res.data.results));
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to load results");
    } finally {
      setLoading(false);
    }
  }

  async function viewDetail(testId) {
    setSelected(testId);
    setDetail(null);
    try {
      const res = await api.get(`/student/results/${testId}`);
      setDetail(res.data);
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to load details");
      setSelected(null);
    }
  }

  function formatDate(d) {
    if (!d) return "—";
    return new Date(d).toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  function formatDuration(sec) {
    const m = Math.floor((sec || 0) / 60);
    const s = (sec || 0) % 60;
    return `${m}m ${s}s`;
  }

  return (
    <div style={styles.wrapper}>
      <header style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={styles.logo}>{initials(user?.institutionName)}</div>
          <div style={styles.brand}>{user?.institutionName || "Exam Portal"}</div>
        </div>
        <div style={styles.userInfo}>
          <Link to="/student" className="btn btn-sm btn-secondary">
            ← Dashboard
          </Link>
          <span style={styles.name}>
            {user.firstName} {user.lastName}
          </span>
          <button
            className="btn btn-sm btn-secondary"
            onClick={async () => {
              await logout();
              navigate("/");
            }}
          >
            Logout
          </button>
        </div>
      </header>

      <div style={styles.content}>
        <h2 style={styles.pageTitle}>My Results</h2>

        {loading && <p className="text-muted">Loading...</p>}

        {!loading && results.length === 0 && (
          <div className="card" style={styles.empty}>
            <p>No published results yet.</p>
            <p className="text-small text-muted">
              Results only appear after your admin reviews and publishes them.
            </p>
          </div>
        )}

        {results.length > 0 && (
          <div className="card" style={{ marginBottom: 24 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Test</th>
                  <th>Submitted</th>
                  <th>Score</th>
                  <th>%</th>
                  <th>Duration</th>
                  <th>Tab Switches</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => {
                  const pct =
                    r.total_marks > 0
                      ? ((r.score / r.total_marks) * 100).toFixed(1)
                      : 0;
                  return (
                    <tr
                      key={r.test_id}
                      style={{ cursor: "pointer" }}
                      onClick={() => viewDetail(r.test_id)}
                    >
                      <td>
                        <b>{r.title}</b>
                      </td>
                      <td className="text-small">{formatDate(r.submitted_at)}</td>
                      <td>
                        <b>{r.score}</b> / {r.total_marks}
                      </td>
                      <td>
                        <span
                          className="badge"
                          style={
                            pct >= 60
                              ? styles.pass
                              : pct >= 40
                              ? styles.warn
                              : styles.fail
                          }
                        >
                          {pct}%
                        </span>
                      </td>
                      <td className="text-small">
                        {formatDuration(r.duration_seconds)}
                      </td>
                      <td className="text-small">{r.tab_switches}</td>
                      <td>
                        <span className="badge badge-info">View</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {detail && (
          <div className="card" style={{ marginTop: 24 }}>
            <div className="flex-between mb-16">
              <h3 style={{ fontSize: 18 }}>{detail.test.title}</h3>
              <button className="btn btn-sm btn-secondary" onClick={() => setDetail(null)}>
                Close
              </button>
            </div>

            <div style={styles.summaryBox}>
              <div>
                <div className="text-muted text-small">Final Score</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: "#4f46e5" }}>
                  {detail.submission.score}
                  <span style={{ fontSize: 16, color: "#64748b" }}>
                    {" "}
                    / {detail.submission.totalMarks}
                  </span>
                </div>
              </div>
              <div>
                <div className="text-muted text-small">Submitted</div>
                <div style={{ fontWeight: 500 }}>
                  {formatDate(detail.submission.submittedAt)}
                </div>
              </div>
              <div>
                <div className="text-muted text-small">Tab Switches</div>
                <div style={{ fontWeight: 500 }}>
                  {detail.submission.tabSwitches}
                </div>
              </div>
              {detail.rank && (
                <div>
                  <div className="text-muted text-small">Batch Rank</div>
                  <div style={{ fontWeight: 600, color: "#10b981", fontSize: 20 }}>
                    #{detail.rank}
                  </div>
                </div>
              )}
            </div>

            <h4 style={{ margin: "20px 0 12px" }}>Question Breakdown</h4>
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Type</th>
                  <th>Question</th>
                  <th>Result</th>
                  <th>Marks</th>
                </tr>
              </thead>
              <tbody>
                {detail.questions.map((q, i) => (
                  <tr key={i}>
                    <td>{q.orderIndex + 1}</td>
                    <td>
                      <span
                        className="badge"
                        style={
                          q.type === "coding"
                            ? { background: "#e0e7ff", color: "#3730a3" }
                            : { background: "#f1f5f9", color: "#475569" }
                        }
                      >
                        {q.type.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ maxWidth: 320 }}>
                      <div
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={q.question}
                      >
                        {q.question}
                      </div>
                      {q.restrictionViolation && (
                        <div className="text-small" style={{ color: "#dc2626" }}>
                          ⚠ Restriction violated: use of `{q.restrictionViolation}`
                        </div>
                      )}
                      {q.caseResults && (
                        <div className="text-small text-muted mt-8">
                          {q.caseResults.filter((c) => c.passed).length}/
                          {q.caseResults.length} test cases passed
                        </div>
                      )}
                    </td>
                    <td>
                      <span
                        className="badge"
                        style={
                          q.isCorrect
                            ? { background: "#d1fae5", color: "#065f46" }
                            : { background: "#fee2e2", color: "#991b1b" }
                        }
                      >
                        {q.isCorrect ? "CORRECT" : "INCORRECT"}
                      </span>
                    </td>
                    <td>
                      <b>{q.earnedMarks}</b>
                      <span className="text-muted text-small"> / {q.marks}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 24px",
    background: "#fff",
    borderBottom: "1px solid #e2e8f0",
  },
  brand: { fontSize: 20, fontWeight: 700, color: "#4f46e5" },
  logo: {
    width: 36,
    height: 36,
    borderRadius: 10,
    background: "#4f46e5",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 15,
    fontWeight: 700,
  },
  userInfo: { display: "flex", alignItems: "center", gap: 12 },
  name: { fontWeight: 500 },
  content: {
    flex: 1,
    overflowY: "auto",
    padding: "24px",
    maxWidth: 1000,
    width: "100%",
    margin: "0 auto",
  },
  pageTitle: { fontSize: 22, fontWeight: 700, marginBottom: 16 },
  empty: { textAlign: "center", padding: 32 },
  summaryBox: {
    display: "flex",
    gap: 40,
    padding: 16,
    background: "#f8fafc",
    borderRadius: 10,
    border: "1px solid #e2e8f0",
  },
  pass: { background: "#d1fae5", color: "#065f46" },
  warn: { background: "#fef3c7", color: "#92400e" },
  fail: { background: "#fee2e2", color: "#991b1b" },
};