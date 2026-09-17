import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { toast } from "react-hot-toast";
import { useAuth } from "../services/auth.jsx";

export default function Login() {
  const { login, loading } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("student");

  async function handleSubmit(e) {
    e.preventDefault();
    if (!identifier || !password) {
      toast.error("Enter your details");
      return;
    }
    const result = await login({ identifier, password, role });
    if (result.ok) {
      toast.success(`Welcome, ${result.user.firstName || "user"}!`);
      navigate(
        result.user.role === "super_admin"
          ? "/super"
          : result.user.role === "admin"
          ? "/admin"
          : "/student"
      );
    } else {
      toast.error(result.error, { duration: 6000 });
    }
  }

  const isSuper = role === "super_admin";

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logo}>V</div>
        <h1 style={styles.title}>Exam Platform</h1>
        <p style={styles.subtitle}>Offline-first exam platform</p>

        <div style={styles.tabs}>
          <button
            style={role === "student" ? styles.tabActive : styles.tab}
            onClick={() => setRole("student")}
          >
            Student
          </button>
          <button
            style={role === "admin" ? styles.tabActive : styles.tab}
            onClick={() => setRole("admin")}
          >
            Admin
          </button>
          <button
            style={role === "super_admin" ? styles.tabActive : styles.tab}
            onClick={() => setRole("super_admin")}
          >
            Owner
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <label className="label">
              {role === "student" ? "Enrollment Number" : "Email"}
            </label>
            <input
              className="input"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder={
                role === "student"
                  ? "e.g., CS2401"
                  : role === "admin"
                  ? "admin@yourcollege.edu"
                  : "owner@platform.app"
              }
            />
          </div>
          <div className="form-row">
            <label className="label">Password</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: "100%", marginTop: 8 }}
            disabled={loading}
          >
            {loading ? "Logging in..." : !isSuper ? "Login" : "Owner Login"}
          </button>
        </form>

        <p style={styles.registerLink}>
          {isSuper ? (
            <span className="text-muted" style={{ fontSize: 13 }}>
              Platform owner accounts are created by the service provider.
            </span>
          ) : (
            <Link to="/register" style={{ fontSize: 13, color: "#4f46e5" }}>
              Is your college new here? Register your institution →
            </Link>
          )}
        </p>
      </div>
    </div>
  );
}

const styles = {
  page: {
    height: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #a855f7 100%)",
  },
  card: {
    background: "#fff",
    borderRadius: 16,
    padding: 40,
    width: 400,
    boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
  },
  logo: {
    width: 56,
    height: 56,
    borderRadius: "50%",
    background: "#4f46e5",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 28,
    fontWeight: 700,
    margin: "0 auto 16px",
  },
  title: {
    textAlign: "center",
    fontSize: 24,
    marginBottom: 4,
    color: "#1e293b",
  },
  subtitle: {
    textAlign: "center",
    color: "#64748b",
    fontSize: 14,
    marginBottom: 24,
  },
  tabs: {
    display: "flex",
    background: "#f1f5f9",
    borderRadius: 10,
    padding: 4,
    marginBottom: 20,
  },
  tab: {
    flex: 1,
    padding: "10px",
    border: "none",
    background: "transparent",
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 500,
    color: "#64748b",
  },
  tabActive: {
    flex: 1,
    padding: "10px",
    border: "none",
    background: "#fff",
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 600,
    color: "#4f46e5",
    boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
  },
  registerLink: {
    textAlign: "center",
    marginTop: 16,
  },
};