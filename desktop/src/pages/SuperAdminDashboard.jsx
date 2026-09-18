import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-hot-toast";
import { api } from "../services/api";
import { useAuth } from "../services/auth.jsx";

const badge = (ok) => ({
  padding: "4px 10px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
  background: ok ? "#d1fae5" : "#fee2e2",
  color: ok ? "#065f46" : "#991b1b",
});

export default function SuperAdminDashboard() {
  const { user, logout } = useAuth();
  const [institutions, setInstitutions] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null); // detail of an institution
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useState("overview");
  const [removeTarget, setRemoveTarget] = useState(null); // institution pending deletion
  const [removeInput, setRemoveInput] = useState("");
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    try {
      const [instRes, statsRes] = await Promise.all([
        api.get("/super/institutions"),
        api.get("/super/stats"),
      ]);
      setInstitutions(instRes.data.institutions);
      setStats(statsRes.data.stats);
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(id) {
    try {
      const res = await api.get(`/super/institutions/${id}`);
      setDetail(res.data);
      setSelected(id);
    } catch (err) {
      toast.error("Failed to load institution detail");
    }
  }

  async function toggleInstitution(inst, activate) {
    if (!confirm(`${activate ? "Approve/activate" : "Deactivate"} ${inst.name}?`)) return;
    try {
      await api.post(`/super/institutions/${inst.id}/${activate ? "activate" : "deactivate"}`);
      toast.success(activate ? "Institution approved & admin activated" : "Institution deactivated");
      loadAll();
      if (selected === inst.id) loadDetail(inst.id);
    } catch {
      toast.error("Action failed");
    }
  }

  async function toggleUser(usr, activate) {
    if (!confirm(`${activate ? "Activate" : "Deactivate"} ${usr.first_name} ${usr.last_name || ""}?`)) return;
    try {
      await api.post(`/super/users/${usr.id}/${activate ? "activate" : "deactivate"}`);
      toast.success("Account updated");
      loadDetail(selected);
    } catch (err) {
      toast.error(err.response?.data?.error || "Action failed");
    }
  }

  async function openRemoveConfirm(inst) {
    setRemoveTarget(inst);
    setRemoveInput("");
  }

  async function closeRemoveConfirm() {
    if (removing) return;
    setRemoveTarget(null);
    setRemoveInput("");
  }

  async function confirmRemove() {
    if (!removeTarget || removeInput !== "DELETE") return;
    setRemoving(true);
    try {
      await api.delete(`/super/institutions/${removeTarget.id}`);
      toast.success(`${removeTarget.name} removed`);
      setSelected(null);
      setDetail(null);
      setRemoveTarget(null);
      setRemoveInput("");
      loadAll();
    } catch (err) {
      toast.error(err.response?.data?.error || "Removal failed");
    } finally {
      setRemoving(false);
    }
  }

  async function handleLogout() {
    await logout();
  }

  const renderHeader = (
    <header style={styles.header}>
      <div style={styles.headerLeft}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {selected && (
            <button style={styles.backBtn} onClick={() => { setSelected(null); setDetail(null); }}>
              ←
            </button>
          )}
          <div style={styles.brand}>{selected && detail ? detail.institution.name : "Platform Owner Dashboard"}</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span style={styles.name}>{user.email}</span>
        <button className="btn btn-sm btn-secondary" onClick={handleLogout}>Logout</button>
      </div>
    </header>
  );

  if (loading) {
    return (
      <div style={styles.wrapper}>
        {renderHeader}
        <div style={styles.center}><p className="text-muted">Loading...</p></div>
      </div>
    );
  }

  if (selected && detail) {
    return (
      <div style={styles.wrapper}>
        {renderHeader}
        <div style={styles.content}>
          <h2 style={styles.pageTitle}>{detail.institution.name}</h2>
          <p className="text-muted text-small">
            Code: <b>{detail.institution.code}</b> · Registered {new Date(detail.institution.createdAt).toLocaleDateString()}
          </p>

          <div style={styles.subTabs}>
            {["admins", "batches", "students"].map((t) => (
              <button key={t} style={tab === t ? styles.tabActive : styles.tab} onClick={() => setTab(t)}>
                {t[0].toUpperCase() + t.slice(1)} ({(["admins", "batches", "students"]).includes(t) && detail[t] ? (t === "batches" ? detail.batches.length : detail[t].length) : 0})
              </button>
            ))}
          </div>

          {tab === "admins" && (
            <div className="card">
              <table className="table">
                <thead>
                  <tr><th>Name</th><th>Email</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>
                  {detail.admins.map((a) => (
                    <tr key={a.id}>
                      <td><b>{a.first_name} {a.last_name}</b></td>
                      <td>{a.email}</td>
                      <td>
                        {a.is_active
                          ? <span style={badge(true)}>Active</span>
                          : <span style={badge(false)}>Deactivated</span>}
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <button className="btn btn-sm btn-secondary" onClick={() => toggleUser(a, !a.is_active)}>
                          {a.is_active ? "Deactivate" : "Activate"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "batches" && (
            <div className="card">
              <table className="table">
                <thead>
                  <tr><th>Batch</th><th>Students</th></tr>
                </thead>
                <tbody>
                  {detail.batches.map((b) => (
                    <tr key={b.id}>
                      <td><b>{b.name}</b></td>
                      <td>{Number(b.student_count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "students" && (
            <div className="card">
              <div style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Name</th><th>Enrollment</th><th>Email</th><th>Batch</th><th>Status</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.students.map((s) => (
                      <tr key={s.id}>
                        <td><b>{s.first_name} {s.last_name}</b></td>
                        <td>{s.enrollment_number || "—"}</td>
                        <td>{s.email || "—"}</td>
                        <td>{s.batch_name || "—"}</td>
                        <td>
                          {s.is_active
                            ? <span style={badge(true)}>Active</span>
                            : <span style={badge(false)}>Deactivated</span>}
                        </td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          <button className="btn btn-sm btn-secondary" onClick={() => toggleUser(s, !s.is_active)}>
                            {s.is_active ? "Deactivate" : "Activate"}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {detail.students.length === 0 && (
                      <tr><td colSpan={6} className="text-muted text-small" style={{ padding: 24, textAlign: "center" }}>No students yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.wrapper}>
      {renderHeader}

      <div style={styles.content}>
        {stats && (
          <div style={styles.statsRow}>
            {[
              { label: "Institutions", value: stats.institutions, color: "#4f46e5" },
              { label: "Pending Approval", value: stats.pendingInstitutions, color: "#f59e0b" },
              { label: "Active Admin Accounts", value: stats.activeInstitutions, color: "#10b981" },
              { label: "Total Students", value: stats.totalStudents, color: "#0ea5e9" },
              { label: "Inactive Students", value: stats.inactiveStudents, color: "#ef4444" },
            ].map((s) => (
              <div className="card" key={s.label} style={styles.statCard}>
                <div style={{ color: s.color, fontSize: 24, fontWeight: 700 }}>{s.value}</div>
                <div className="text-muted text-small">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        <div className="card">
          <h3>Institutions</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Institution</th>
                <th>Code</th>
                <th>Admin</th>
                <th>Admins</th>
                <th>Students</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {institutions.map((i) => (
                <tr key={i.id}>
                  <td><b>{i.name}</b></td>
                  <td style={{ color: "#64748b" }}>{i.code}</td>
                  <td>
                    {i.admin ? (
                      <span>
                        {i.admin.firstName} {i.admin.lastName}
                        <div className="text-muted text-small">{i.admin.email}</div>
                      </span>
                    ) : (
                      <span className="text-muted text-small">No admin</span>
                    )}
                  </td>
                  <td>{i.adminCount}</td>
                  <td>{i.studentCount}</td>
                  <td>
                    {i.active
                      ? <span style={badge(true)}>Active</span>
                      : <span style={badge(false)}>Deactivated</span>}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {i.code === "PLATFORM" ? (
                      <span className="text-muted text-small">Platform owner — locked</span>
                    ) : (
                      <>
                        <button className="btn btn-sm btn-secondary" onClick={() => loadDetail(i.id)}>Manage</button>{" "}
                        {i.active
                          ? <button className="btn btn-sm btn-danger" onClick={() => toggleInstitution(i, false)}>Deactivate</button>
                          : <button className="btn btn-sm btn-primary" onClick={() => toggleInstitution(i, true)}>Activate</button>}{" "}
                        <button
                          className="btn btn-sm btn-danger"
                          style={{ background: "#fff", color: "#dc2626", border: "1px solid #fecaca" }}
                          onClick={() => openRemoveConfirm(i)}
                          title="Permanently delete this college"
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {institutions.length === 0 && (
                <tr><td colSpan={7} className="text-muted text-small" style={{ padding: 24, textAlign: "center" }}>No institutions registered yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="text-muted" style={{ fontSize: 13, marginTop: 16 }}>
          New registrations appear here as <span style={badge(false)}>Deactivated</span>. Click <b>Activate</b> to approve — the
          institution admin can then log in. Deactivated users see "contact the service owner" when trying to log in.
        </p>
      </div>

      {removeTarget && (
        <div style={styles.modalOverlay} onClick={closeRemoveConfirm}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0, color: "#991b1b" }}>Delete institution</h3>
            <p>
              Permanently delete <b>{removeTarget.name}</b> ({removeTarget.studentCount} students, tests, results)?
              This cannot be undone.
            </p>
            <p className="text-muted text-small" style={{ marginBottom: 8 }}>
              Type <b>DELETE</b> to confirm:
            </p>
            <input
              type="text"
              value={removeInput}
              onChange={(e) => setRemoveInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && removeInput === "DELETE") confirmRemove(); }}
              autoFocus
              style={styles.modalInput}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={closeRemoveConfirm} disabled={removing}>Cancel</button>
              <button
                className="btn btn-danger"
                onClick={confirmRemove}
                disabled={removing || removeInput !== "DELETE"}
              >
                {removing ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  wrapper: { height: "100vh", display: "flex", flexDirection: "column" },
  modalOverlay: {
    position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
  },
  modal: {
    background: "#fff", borderRadius: 12, padding: 24, width: 420, maxWidth: "90%",
    boxShadow: "0 20px 50px rgba(0,0,0,0.3)",
  },
  modalInput: {
    width: "100%", padding: "10px 12px", borderRadius: 8,
    border: "1px solid #cbd5e1", fontSize: 14, boxSizing: "border-box",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "16px 24px",
    background: "#1e1b4b",
    color: "#fff",
  },
  headerLeft: { display: "flex", alignItems: "center", gap: 8 },
  backBtn: {
    background: "rgba(255,255,255,0.1)",
    border: "none",
    color: "#fff",
    width: 32,
    height: 32,
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 16,
  },
  brand: { fontSize: 18, fontWeight: 700, color: "#fff" },
  name: { fontSize: 14, color: "#c7d2fe" },
  center: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center" },
  content: { flex: 1, overflowY: "auto", padding: 24, maxWidth: 1100, width: "100%", margin: "0 auto" },
  pageTitle: { marginBottom: 4, color: "#1e293b" },
  statsRow: { display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 20 },
  statCard: { textAlign: "center", padding: "20px 12px" },
  subTabs: { display: "flex", gap: 8, margin: "16px 0" },
  tab: {
    padding: "8px 16px",
    border: "1px solid #e2e8f0",
    background: "#fff",
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 14,
    color: "#64748b",
    fontWeight: 500,
  },
  tabActive: {
    padding: "8px 16px",
    border: "1px solid #4f46e5",
    background: "#eef2ff",
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 14,
    color: "#4f46e5",
    fontWeight: 600,
  },
};