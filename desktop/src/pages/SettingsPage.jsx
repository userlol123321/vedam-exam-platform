import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import { checkServerHealth, API_BASE } from "../services/api";
import { useAuth } from "../services/auth.jsx";

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [serverUrl, setServerUrl] = useState(API_BASE);
  const [health, setHealth] = useState(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    check();
    (async () => {
      try {
        const stored = await window.electronAPI?.storeGet?.("server-url");
        if (stored) {
          setServerUrl(stored);
          localStorage.setItem("vedam_server_url", stored);
        }
      } catch {}
    })();
  }, []);

  async function check() {
    setChecking(true);
    try {
      const ok = await checkServerHealth();
      setHealth(ok);
    } catch {
      setHealth(false);
    } finally {
      setChecking(false);
    }
  }

  async function saveServerUrl() {
    const clean = serverUrl.trim().replace(/\/+$/, "");
    localStorage.setItem("vedam_server_url", clean);
    try {
      await window.electronAPI?.storeSet("server-url", clean);
      toast.success("Server URL saved. Restart the app for it to take effect.");
    } catch {
      toast.success("Server URL saved locally.");
    }
  }

  return (
    <div style={styles.wrapper}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <Link to={user?.role === "admin" ? "/admin" : "/student"} style={styles.back}>
            ← Back
          </Link>
          <div style={styles.brand}>Settings</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={styles.name}>{user?.email || user?.firstName}</span>
          <button className="btn btn-sm btn-secondary" onClick={async () => {
            await logout();
            navigate("/");
          }}>
            Logout
          </button>
        </div>
      </header>

      <div style={styles.content}>
        <div className="card" style={{ maxWidth: 640, margin: "0 auto" }}>
          <h3 className="mb-16">Server Connection</h3>

          <div className="form-row">
            <label className="label">Server URL (backend API base)</label>
            <input
              className="input"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="https://your-server.onrender.com"
            />
          </div>

          <div className="flex gap-8 mb-16">
            <button className="btn btn-primary" onClick={saveServerUrl}>
              Save URL
            </button>
            <button className="btn btn-secondary" onClick={check}>
              {checking ? "Checking..." : "Test Connection"}
            </button>
          </div>

          {health !== null && (
            <div
              style={{
                padding: "12px 16px",
                borderRadius: 8,
                background: health ? "#d1fae5" : "#fee2e2",
                color: health ? "#065f46" : "#991b1b",
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              {health
                ? "✓ Server is reachable and healthy."
                : "✗ Cannot reach server. Check the URL and that the server is running."}
            </div>
          )}

          <hr style={{ border: "none", borderTop: "1px solid #e2e8f0", margin: "20px 0" }} />

          <h4 className="mb-16">How offline mode works</h4>
          <p className="text-muted text-small" style={{ lineHeight: 1.7 }}>
            When you start an exam, the encrypted questions are cached locally. If the
            connection drops mid-exam, the test continues — your answers, timer and
            tab-switch count are saved as you go. When you're back online (or open the
            app next and connect), the submission auto-syncs to the server for grading.
            For full offline use of an already-started exam, you can open the app
            without internet — your saved progress is restored.
          </p>
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
  name: { fontSize: 14, color: "#64748b" },
  content: { flex: 1, overflowY: "auto", padding: 24 },
};