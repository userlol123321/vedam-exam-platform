import React, { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { toast } from "react-hot-toast";
import { api } from "../services/api";
import { useAuth } from "../services/auth.jsx";
import { initials } from "../utils/branding";

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState("tests"); // tests | batches | students
  const [tests, setTests] = useState([]);
  const [batches, setBatches] = useState([]);
  const [students, setStudents] = useState([]);
  const [selectedBatch, setSelectedBatch] = useState("");
  const [showNewBatch, setShowNewBatch] = useState(false);
  const [newBatchName, setNewBatchName] = useState("");
  const [loading, setLoading] = useState(false);
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [newStudent, setNewStudent] = useState({
    firstName: "",
    lastName: "",
    enrollmentNumber: "",
    password: "",
    batchId: "",
  });

  async function load() {
    try {
      const [testsRes, batchesRes] = await Promise.all([
        api.get("/admin/tests"),
        api.get("/admin/batches"),
      ]);
      setTests(testsRes.data.tests);
      setBatches(batchesRes.data.batches);
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to load data");
    }
  }

  async function loadStudents(batchId = selectedBatch) {
    try {
      const params = batchId ? { params: { batchId } } : {};
      const res = await api.get("/admin/students", params);
      setStudents(res.data.students);
    } catch (err) {
      toast.error("Failed to load students");
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (tab === "students") loadStudents();
  }, [tab]);

  async function createBatch() {
    if (!newBatchName.trim()) return toast.error("Enter batch name");
    try {
      const res = await api.post("/admin/batches", { name: newBatchName.trim() });
      setBatches((b) => [...b, res.data.batch]);
      setNewBatchName("");
      setShowNewBatch(false);
      toast.success("Batch created");
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to create batch");
    }
  }

  async function addStudent() {
    if (!newStudent.firstName || !newStudent.lastName || !newStudent.enrollmentNumber || !newStudent.password) {
      return toast.error("Fill all required fields");
    }
    if (!newStudent.batchId) return toast.error("Select a batch");
    try {
      await api.post("/admin/students", newStudent);
      toast.success("Student added");
      setNewStudent({ firstName: "", lastName: "", enrollmentNumber: "", password: "", batchId: "" });
      setShowAddStudent(false);
      loadStudents(newStudent.batchId || undefined);
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to add student");
    }
  }

  async function handleCSV(e) {
    const file = e.target.files[0];
    if (!file || !selectedBatch) return toast.error("Select a batch first");
    setLoading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("batchId", selectedBatch);
      const res = await api.post("/admin/students/bulk", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success(`Imported ${res.data.created}/${res.data.total} students to ${res.data.batchName}`);
      res.data.errors?.slice(0, 5).forEach((err) => toast(err, { icon: "⚠" }));
      loadStudents(selectedBatch);
    } catch (err) {
      toast.error(err.response?.data?.error || "CSV upload failed");
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  }

  async function deleteStudent(id) {
    if (!confirm("Remove this student?")) return;
    try {
      await api.delete(`/admin/students/${id}`);
      toast.success("Student removed");
      loadStudents();
    } catch (err) {
      toast.error("Failed to remove student");
    }
  }

  async function toggleStudentActive(student) {
    try {
      await api.patch(`/admin/students/${student.id}`, {
        isActive: !student.is_active,
      });
      loadStudents();
    } catch (err) {
      toast.error("Failed to update");
    }
  }

  async function downloadTemplate() {
    const res = await api.get("/admin/export-template", { responseType: "text" });
    const blob = new Blob([res.data], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "students-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function formatDate(d) {
    if (!d) return "—";
    return new Date(d).toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  function testStatus(test) {
    const now = new Date();
    if (now < new Date(test.available_from)) return { label: "Scheduled", color: "#f59e0b" };
    if (now <= new Date(test.available_until)) return { label: "Live", color: "#10b981" };
    return { label: "Ended", color: "#64748b" };
  }

  return (
    <div style={styles.wrapper}>
      <header style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={styles.logo}>{initials(user?.institutionName)}</div>
          <div style={styles.brand}>{user?.institutionName || "Admin Portal"}</div>
        </div>
        <div style={styles.userInfo}>
          <Link to="/settings" style={styles.settingsLink}>
            ⚙ Settings
          </Link>
          <span style={styles.name}>{user.email}</span>
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

      <div style={styles.layout}>
        <nav style={styles.sidebar}>
          <button
            style={tab === "tests" ? styles.navActive : styles.navBtn}
            onClick={() => setTab("tests")}
          >
            📋 Tests
          </button>
          <button
            style={tab === "batches" ? styles.navActive : styles.navBtn}
            onClick={() => setTab("batches")}
          >
            🧑‍🤝‍🧑 Batches
          </button>
          <button
            style={tab === "students" ? styles.navActive : styles.navBtn}
            onClick={() => setTab("students")}
          >
            👤 Students
          </button>
        </nav>

        <main style={styles.main}>
          {/* ===== TESTS TAB ===== */}
          {tab === "tests" && (
            <div>
              <div className="flex-between mb-16">
                <h2 style={styles.pageTitle}>Tests</h2>
                <button className="btn btn-primary" onClick={() => navigate("/admin/test/new")}>
                  + New Test
                </button>
              </div>

              {tests.length === 0 ? (
                <div className="card" style={styles.empty}>
                  <p>No tests yet.</p>
                  <p className="text-small text-muted">
                    Create a test and schedule it for a batch.
                  </p>
                </div>
              ) : (
                <div className="card">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Test</th>
                        <th>Batch</th>
                        <th>Starts</th>
                        <th>Duration</th>
                        <th>Questions</th>
                        <th>Status</th>
                        <th>Results</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {tests.map((t) => {
                        const st = testStatus(t);
                        return (
                          <tr key={t.id}>
                            <td>
                              <b>{t.title}</b>
                              <div className="text-small text-muted">{t.description}</div>
                            </td>
                            <td>{t.batch_name || "—"}</td>
                            <td className="text-small">{formatDate(t.available_from)}</td>
                            <td>{t.duration_minutes}m</td>
                            <td>{t.question_count}</td>
                            <td>
                              <span className="badge" style={{ background: st.color + "1a", color: st.color }}>
                                {st.label}
                              </span>
                            </td>
                            <td>
                              <span className="badge" style={{
                                background: t.results_published ? "#d1fae5" : "#f1f5f9",
                                color: t.results_published ? "#065f46" : "#64748b",
                              }}>
                                {t.results_published ? "Published" : "Hidden"}
                              </span>
                            </td>
                            <td style={{ whiteSpace: "nowrap" }}>
                              <button
                                className="btn btn-sm btn-secondary"
                                onClick={() => navigate(`/admin/test/${t.id}`)}
                              >
                                Build
                              </button>{" "}
                              <button
                                className="btn btn-sm btn-secondary"
                                onClick={() => navigate(`/admin/results/${t.id}`)}
                              >
                                Results
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ===== BATCHES TAB ===== */}
          {tab === "batches" && (
            <div>
              <div className="flex-between mb-16">
                <h2 style={styles.pageTitle}>Batches</h2>
                <button className="btn btn-primary" onClick={() => setShowNewBatch((v) => !v)}>
                  + New Batch
                </button>
              </div>

              {showNewBatch && (
                <div className="card mb-16" style={{ display: "flex", gap: 12 }}>
                  <input
                    className="input"
                    placeholder="Batch name (e.g., 2nd Year A)"
                    value={newBatchName}
                    onChange={(e) => setNewBatchName(e.target.value)}
                    style={{ maxWidth: 300 }}
                  />
                  <button className="btn btn-primary" onClick={createBatch}>
                    Create
                  </button>
                </div>
              )}

              <div className="grid-2">
                {batches.map((b) => (
                  <div key={b.id} className="card" style={{ cursor: "pointer" }}
                    onClick={() => { setTab("students"); setSelectedBatch(String(b.id)); loadStudents(b.id); }}>
                    <div className="flex-between">
                      <div>
                        <b style={{ fontSize: 16 }}>{b.name}</b>
                        <div className="text-small text-muted mt-8">
                          {b.student_count} students
                        </div>
                      </div>
                      <span className="badge badge-info">View →</span>
                    </div>
                  </div>
                ))}
                {batches.length === 0 && (
                  <div className="card" style={styles.empty}>
                    <p className="text-muted">No batches yet. Create one to start adding students.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ===== STUDENTS TAB ===== */}
          {tab === "students" && (
            <div>
              <div className="flex-between mb-16">
                <h2 style={styles.pageTitle}>Students</h2>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-secondary" onClick={downloadTemplate}>
                    CSV Template
                  </button>
                  <button className="btn btn-primary" onClick={() => setShowAddStudent((v) => !v)}>
                    + Add Student
                  </button>
                </div>
              </div>

              {/* Batch filter + upload */}
              <div className="card mb-16" style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <select
                  className="input"
                  style={{ maxWidth: 220 }}
                  value={selectedBatch}
                  onChange={(e) => {
                    setSelectedBatch(e.target.value);
                    loadStudents(e.target.value);
                  }}
                >
                  <option value="">All batches</option>
                  {batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <label className="btn btn-secondary" style={{ cursor: "pointer" }}>
                  📄 Upload CSV {loading && "(importing...)"}
                  <input
                    type="file"
                    accept=".csv"
                    style={{ display: "none" }}
                    onChange={handleCSV}
                    disabled={loading}
                  />
                </label>
                {selectedBatch && (
                  <span className="text-small text-muted">
                    CSV columns: first_name,last_name,enrollment_number,password[,email]
                  </span>
                )}
              </div>

              {showAddStudent && (
                <div className="card mb-16">
                  <h4 className="mb-16">Add Single Student</h4>
                  <div className="grid-2">
                    <div className="form-row">
                      <label className="label">First name *</label>
                      <input
                        className="input"
                        value={newStudent.firstName}
                        onChange={(e) => setNewStudent({ ...newStudent, firstName: e.target.value })}
                      />
                    </div>
                    <div className="form-row">
                      <label className="label">Last name *</label>
                      <input
                        className="input"
                        value={newStudent.lastName}
                        onChange={(e) => setNewStudent({ ...newStudent, lastName: e.target.value })}
                      />
                    </div>
                    <div className="form-row">
                      <label className="label">Enrollment number *</label>
                      <input
                        className="input"
                        value={newStudent.enrollmentNumber}
                        onChange={(e) => setNewStudent({ ...newStudent, enrollmentNumber: e.target.value })}
                      />
                    </div>
                    <div className="form-row">
                      <label className="label">Password *</label>
                      <input
                        className="input"
                        value={newStudent.password}
                        onChange={(e) => setNewStudent({ ...newStudent, password: e.target.value })}
                      />
                    </div>
                    <div className="form-row">
                      <label className="label">Batch</label>
                      <select
                        className="input"
                        value={newStudent.batchId}
                        onChange={(e) => setNewStudent({ ...newStudent, batchId: e.target.value })}
                      >
                        <option value="">Select batch</option>
                        {batches.map((b) => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-8">
                    <button className="btn btn-primary" onClick={addStudent}>Add Student</button>
                    <button className="btn btn-secondary" onClick={() => setShowAddStudent(false)}>Cancel</button>
                  </div>
                </div>
              )}

              <div className="card">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Enrollment</th>
                      <th>Batch</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s) => {
                      const batch = batches.find((b) => String(b.id) === String(s.batch_id));
                      return (
                        <tr key={s.id}>
                          <td>
                            <b>{s.first_name} {s.last_name}</b>
                          </td>
                          <td>{s.enrollment_number}</td>
                          <td>{batch?.name || "—"}</td>
                          <td>
                            <span className="badge" style={{
                              background: s.is_active ? "#d1fae5" : "#fee2e2",
                              color: s.is_active ? "#065f46" : "#991b1b",
                            }}>
                              {s.is_active ? "Active" : "Deactivated"}
                            </span>
                          </td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            <button
                              className="btn btn-sm btn-secondary"
                              onClick={() => toggleStudentActive(s)}
                            >
                              {s.is_active ? "Disable" : "Enable"}
                            </button>{" "}
                            <button
                              className="btn btn-sm btn-danger"
                              onClick={() => deleteStudent(s.id)}
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {students.length === 0 && (
                      <tr>
                        <td colSpan={5} style={{ textAlign: "center", padding: 24 }} className="text-muted">
                          No students. Upload a CSV or add one manually.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
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
    background: "#1e293b",
    color: "#fff",
  },
  brand: { fontSize: 20, fontWeight: 700, color: "#a5b4fc" },
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
  settingsLink: { color: "#cbd5e1", textDecoration: "none", fontSize: 14 },
  name: { fontSize: 14, color: "#cbd5e1" },
  layout: { flex: 1, display: "flex", overflow: "hidden" },
  sidebar: {
    width: 180,
    background: "#fff",
    borderRight: "1px solid #e2e8f0",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: 16,
  },
  navBtn: {
    padding: "12px 14px",
    border: "none",
    background: "transparent",
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 14,
    textAlign: "left",
    color: "#475569",
  },
  navActive: {
    padding: "12px 14px",
    border: "none",
    background: "#eef2ff",
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 14,
    textAlign: "left",
    color: "#4f46e5",
    fontWeight: 600,
  },
  main: { flex: 1, overflowY: "auto", padding: 24 },
  pageTitle: { fontSize: 20, fontWeight: 700 },
  empty: { textAlign: "center", padding: 32 },
};