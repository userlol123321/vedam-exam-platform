import React, { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { toast } from "react-hot-toast";
import { api } from "../services/api";
import { useAuth } from "../services/auth.jsx";
import { initials } from "../utils/branding";

export default function StudentDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("available");

  useEffect(() => {
    loadTests();
  }, []);

  async function loadTests() {
    try {
      const [testsRes, resultsRes] = await Promise.all([
        api.get("/student/tests"),
        api.get("/student/results"),
      ]);
      setTests(testsRes.data.tests);
      localStorage.setItem("vedam_results", JSON.stringify(resultsRes.data.results));
    } catch (err) {
      const msg = err.response?.data?.error || "Failed to load tests";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  const pastResults = JSON.parse(localStorage.getItem("vedam_results") || "[]");

  function formatDate(d) {
    if (!d) return "—";
    return new Date(d).toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  function isLive(test) {
    const now = new Date();
    return (
      now >= new Date(test.available_from) &&
      now <= new Date(test.available_until) &&
      !test.submission_id
    );
  }

  async function handleLogout() {
    await logout();
    navigate("/");
  }

  const liveTests = tests.filter(isLive);
  const upcomingTests = tests.filter((t) => new Date(t.available_from) > new Date());
  const doneTests = tests.filter(
    (t) => t.submission_id && new Date(t.available_from) <= new Date()
  );

  return (
    <div style={styles.wrapper}>
      <header style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={styles.logo}>{initials(user?.institutionName)}</div>
          <div style={styles.brand}>{user?.institutionName || "Exam Portal"}</div>
        </div>
        <div style={styles.userInfo}>
          <span style={styles.badgeInfo}>{user.batchName || "No batch"}</span>
          <span style={styles.name}>
            {user.firstName} {user.lastName}
          </span>
          <button className="btn btn-sm btn-secondary" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      <div style={styles.content}>
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Available Tests</h2>

          {loading && <p className="text-muted">Loading tests...</p>}

          {!loading && liveTests.length === 0 && (
            <div className="card" style={styles.empty}>
              <p>No live tests right now.</p>
              <p className="text-small text-muted">
                Tests appear here automatically at their scheduled start time.
              </p>
            </div>
          )}

          <div style={styles.grid}>
            {liveTests.map((test) => (
              <div key={test.id} className="card" style={styles.testCard}>
                <div style={styles.testHeader}>
                  <h3 style={styles.testTitle}>{test.title}</h3>
                  <span className="badge badge-success">LIVE</span>
                </div>
                <p className="text-small text-muted" style={{ marginBottom: 12 }}>
                  {test.description || "No description"}
                </p>
                <div style={styles.testMeta}>
                  <div>
                    <span className="text-muted text-small">Questions:</span>{" "}
                    <b>{test.question_count}</b>
                  </div>
                  <div>
                    <span className="text-muted text-small">Duration:</span>{" "}
                    <b>{test.duration_minutes} min</b>
                  </div>
                </div>
                <div style={styles.testMeta}>
                  <div>
                    <span className="text-muted text-small">Opens:</span>{" "}
                    {formatDate(test.available_from)}
                  </div>
                </div>
                <div style={styles.testMeta}>
                  <div>
                    <span className="text-muted text-small">Closes:</span>{" "}
                    {formatDate(test.available_until)}
                  </div>
                </div>
                <button
                  className="btn btn-primary"
                  style={{ width: "100%", marginTop: 16 }}
                  onClick={() => navigate(`/exam/${test.id}`)}
                >
                  Start Test
                </button>
              </div>
            ))}
          </div>
        </div>

        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Upcoming Tests</h2>
          {upcomingTests.length === 0 ? (
            <p className="text-muted text-small">No scheduled tests.</p>
          ) : (
            <div className="card">
              {upcomingTests.map((test) => (
                <div key={test.id} style={styles.upcomingRow}>
                  <div>
                    <b>{test.title}</b>
                    <div className="text-small text-muted">
                      {formatDate(test.available_from)}
                    </div>
                  </div>
                  <span className="badge badge-warning">Scheduled</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={styles.section}>
          <div className="flex-between">
            <h2 style={styles.sectionTitle}>Past Results</h2>
            <Link to="/student/results" className="btn btn-sm btn-secondary">
              View all results
            </Link>
          </div>
          {pastResults.length === 0 ? (
            <p className="text-muted text-small">
              No published results yet. Results appear here after your admin
              reviews and publishes them.
            </p>
          ) : (
            <div className="card">
              {pastResults.slice(0, 5).map((r) => (
                <div key={r.test_id} style={styles.upcomingRow}>
                  <div>
                    <b>{r.title}</b>
                    <div className="text-small text-muted">
                      {formatDate(r.submitted_at)}
                    </div>
                  </div>
                  <span
                    className="badge"
                    style={{
                      background: "#d1fae5",
                      color: "#065f46",
                      fontSize: 14,
                    }}
                  >
                    {r.score} / {r.total_marks}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
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
  userInfo: { display: "flex", alignItems: "center", gap: 16 },
  badgeInfo: {
    background: "#eef2ff",
    color: "#4f46e5",
    padding: "4px 12px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
  },
  name: { fontWeight: 500 },
  content: {
    flex: 1,
    overflowY: "auto",
    padding: "24px",
    maxWidth: 1000,
    width: "100%",
    margin: "0 auto",
  },
  section: { marginBottom: 32 },
  sectionTitle: { fontSize: 18, fontWeight: 600, marginBottom: 12 },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 },
  testCard: { display: "flex", flexDirection: "column" },
  testHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  testTitle: { fontSize: 17, fontWeight: 600 },
  testMeta: { display: "flex", gap: 24, marginTop: 6, fontSize: 13 },
  upcomingRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 0",
    borderBottom: "1px solid #e2e8f0",
  },
  empty: { textAlign: "center", padding: "32px" },
};