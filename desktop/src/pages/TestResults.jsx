import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { toast } from "react-hot-toast";
import { api } from "../services/api";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

export default function TestResults() {
  const { testId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      const res = await api.get(`/admin/results/${testId}`);
      setData(res.data);
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to load results");
    } finally {
      setLoading(false);
    }
  }

  async function publish() {
    if (!confirm("Publish these results to all students?")) return;
    try {
      await api.post(`/admin/results/${testId}/publish`);
      toast.success("Results published — students can now see their scores");
      load();
    } catch (err) {
      toast.error("Failed to publish");
    }
  }

  async function unpublish() {
    if (!confirm("Hide results from students again?")) return;
    try {
      await api.post(`/admin/results/${testId}/unpublish`);
      toast.success("Results hidden");
      load();
    } catch (err) {
      toast.error("Failed to hide results");
    }
  }

  if (loading) {
    return (
      <div style={styles.center}>
        <p className="text-muted">Loading analytics...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={styles.center}>
        <p className="text-muted">No data.</p>
        <Link to="/admin" className="btn btn-secondary">← Back</Link>
      </div>
    );
  }

  const distData = Object.entries(data.distribution.buckets).map(([name, value]) => ({
    name,
    count: value,
  }));

  const pieData = [
    { name: "Passed", value: data.stats.passed },
    { name: "Below 50%", value: data.stats.totalSubmissions - data.stats.passed },
  ];

  const COLORS = ["#10b981", "#ef4444"];

  return (
    <div style={styles.wrapper}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <Link to="/admin" style={styles.back}>← Admin</Link>
          <div style={styles.brand}>Results — {data.test.title}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="badge" style={{
            background: data.test.resultsVisibility === "visible" ? "#d1fae5" : "#f1f5f9",
            color: data.test.resultsVisibility === "visible" ? "#065f46" : "#64748b",
          }}>
            {data.test.resultsVisibility === "visible" ? "Visible to students" : "Hidden from students"}
          </span>
          {data.test.resultsVisibility === "visible" ? (
            <button className="btn btn-sm btn-secondary" onClick={unpublish}>
              Hide Results
            </button>
          ) : (
            <button className="btn btn-primary" onClick={publish}>
              ✓ Publish Results
            </button>
          )}
        </div>
      </header>

      <div style={styles.content}>
        {/* Stat cards */}
        <div style={styles.statsRow}>
          <div className="card" style={styles.statCard}>
            <div className="text-muted text-small">Submissions</div>
            <div style={styles.statNum}>{data.stats.totalSubmissions}</div>
          </div>
          <div className="card" style={styles.statCard}>
            <div className="text-muted text-small">Average</div>
            <div style={styles.statNum}>{data.stats.avgScore}%</div>
          </div>
          <div className="card" style={styles.statCard}>
            <div className="text-muted text-small">Highest</div>
            <div style={{ ...styles.statNum, color: "#10b981" }}>{data.stats.maxScore}</div>
          </div>
          <div className="card" style={styles.statCard}>
            <div className="text-muted text-small">Lowest</div>
            <div style={{ ...styles.statNum, color: "#ef4444" }}>{data.stats.minScore}</div>
          </div>
          <div className="card" style={styles.statCard}>
            <div className="text-muted text-small">Pass Rate (≥50%)</div>
            <div style={styles.statNum}>{data.stats.passRate}%</div>
          </div>
        </div>

        {/* Charts */}
        <div className="grid-2">
          <div className="card">
            <h4 className="mb-16">Score Distribution</h4>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={distData}>
                <XAxis dataKey="name" fontSize={12} />
                <YAxis allowDecimals={false} fontSize={12} />
                <Tooltip />
                <Bar dataKey="count" fill="#4f46e5" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="card">
            <h4 className="mb-16">Pass / Fail</h4>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label>
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Per-question analysis */}
        <div className="card mt-24">
          <h4 className="mb-16">Per-Question Analysis</h4>
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Type</th>
                <th>Attempts</th>
                <th>Success Rate</th>
                <th>Avg Marks</th>
                <th>Progress</th>
              </tr>
            </thead>
            <tbody>
              {data.perQuestion.map((q) => (
                <tr key={q.id}>
                  <td>{q.orderIndex + 1}</td>
                  <td>
                    <span className="badge" style={q.type === "coding" ? { background: "#e0e7ff", color: "#3730a3" } : { background: "#f1f5f9", color: "#475569" }}>
                      {q.type.toUpperCase()}
                    </span>
                  </td>
                  <td>{q.attempts}</td>
                  <td>
                    <b>{q.successRate}%</b>
                  </td>
                  <td>
                    {q.avgEarned} / marks
                  </td>
                  <td style={{ width: 200 }}>
                    <div style={styles.progressTrack}>
                      <div
                        style={{
                          width: `${Math.min(100, q.successRate)}%`,
                          ...styles.progressFill,
                        }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Flagged violations */}
        {data.violations.length > 0 && (
          <div className="card mt-24" style={{ borderColor: "#fca5a5" }}>
            <h4 className="mb-16" style={{ color: "#991b1b" }}>
              ⚠ Tab-Switch Violations ({data.violations.length})
            </h4>
            <table className="table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Tab Switches</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {data.violations.map((v) => (
                  <tr key={v.id}>
                    <td>{v.name} ({v.enrollmentNumber})</td>
                    <td style={{ color: "#dc2626", fontWeight: 600 }}>{v.tabSwitches}</td>
                    <td>{v.score}/{v.totalMarks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Student results table */}
        <div className="card mt-24">
          <h4 className="mb-16">All Student Results ({data.students.length})</h4>
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Student</th>
                  <th>Enrollment</th>
                  <th>Score</th>
                  <th>%</th>
                  <th>Duration</th>
                  <th>Tab Switches</th>
                </tr>
              </thead>
              <tbody>
                {data.students.map((s, i) => (
                  <tr key={s.id} style={s.flagged ? { background: "#fef2f2" } : {}}>
                    <td>{i + 1}</td>
                    <td><b>{s.name}</b></td>
                    <td>{s.enrollmentNumber}</td>
                    <td><b>{s.score}</b> / {s.totalMarks}</td>
                    <td>
                      <span className="badge" style={{
                        background: s.percentage >= 60 ? "#d1fae5" : s.percentage >= 40 ? "#fef3c7" : "#fee2e2",
                        color: s.percentage >= 60 ? "#065f46" : s.percentage >= 40 ? "#92400e" : "#991b1b",
                      }}>
                        {s.percentage}%
                      </span>
                    </td>
                    <td className="text-small">
                      {s.duration_seconds ? `${Math.floor(s.duration_seconds / 60)}m ${s.duration_seconds % 60}s` : "—"}
                    </td>
                    <td>
                      {s.flagged ? (
                        <span className="badge badge-danger">⚠ {s.tabSwitches}</span>
                      ) : (
                        <span className="text-muted text-small">{s.tabSwitches}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
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
  center: { height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 },
  content: { flex: 1, overflowY: "auto", padding: 24, maxWidth: 1000, width: "100%", margin: "0 auto" },
  statsRow: { display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 20 },
  statCard: { textAlign: "center", padding: "16px 12px" },
  statNum: { fontSize: 26, fontWeight: 700, marginTop: 4 },
  progressTrack: { background: "#e2e8f0", height: 8, borderRadius: 4, overflow: "hidden" },
  progressFill: { background: "#4f46e5", height: "100%", borderRadius: 4 },
};