import React, { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-hot-toast";
import { api } from "../services/api";

export default function RegisterPage() {
  const [form, setForm] = useState({
    institutionName: "",
    institutionCode: "",
    adminFirstName: "",
    adminLastName: "",
    adminEmail: "",
    password: "",
    confirm: "",
  });
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  function set(field) {
    return (e) => setForm({ ...form, [field]: e.target.value });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const required = ["institutionName", "institutionCode", "adminFirstName", "adminLastName", "adminEmail", "password"];
    for (const k of required) {
      if (!form[k].trim()) {
        toast.error("Fill all fields");
        return;
      }
    }
    if (form.password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    if (form.password !== form.confirm) {
      toast.error("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const res = await api.post("/auth/register", {
        institutionName: form.institutionName,
        institutionCode: form.institutionCode,
        adminFirstName: form.adminFirstName,
        adminLastName: form.adminLastName,
        adminEmail: form.adminEmail,
        password: form.password,
      });
      toast.success(res.data.message);
      setSubmitted(true);
    } catch (err) {
      toast.error(err.response?.data?.error || "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.check}>✓</div>
          <h1 style={styles.title}>Registration submitted</h1>
          <p className="text-muted" style={styles.muted}>
            Your institution account has been created but is{" "}
            <b>pending approval</b>. The platform service owner will activate it
            before you can log in. Activation usually happens within 1 business
            day — you'll be able to sign in once approved.
          </p>
          <p className="text-muted" style={styles.muted}>
            If your institution isn't activated within 2 days, contact the service
            owner directly.
          </p>
          <Link to="/" className="btn btn-primary" style={{ ...styles.fullBtn, textDecoration: "none", textAlign: "center" }}>
            Back to Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>Register your institution</h1>
        <p style={styles.subtitle}>
          Create an account for your college. Once registered, it must be
          approved by the platform owner before use.
        </p>

        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <label className="label">Institution Name</label>
            <input className="input" value={form.institutionName} onChange={set("institutionName")} placeholder="e.g., Vishwakarma Institute of Technology" />
          </div>
          <div className="form-row">
            <label className="label">Institution Code (unique)</label>
            <input className="input" value={form.institutionCode} onChange={set("institutionCode")} placeholder="e.g., VEDAM01" style={{ textTransform: "uppercase" }} />
          </div>

          <div className="grid-2 gap-8">
            <div className="form-row">
              <label className="label">Admin First Name</label>
              <input className="input" value={form.adminFirstName} onChange={set("adminFirstName")} placeholder="First name" />
            </div>
            <div className="form-row">
              <label className="label">Admin Last Name</label>
              <input className="input" value={form.adminLastName} onChange={set("adminLastName")} placeholder="Last name" />
            </div>
          </div>

          <div className="form-row">
            <label className="label">Admin Email</label>
            <input className="input" type="email" value={form.adminEmail} onChange={set("adminEmail")} placeholder="admin@yourcollege.edu" />
          </div>

          <div className="grid-2 gap-8">
            <div className="form-row">
              <label className="label">Password</label>
              <input className="input" type="password" value={form.password} onChange={set("password")} placeholder="Min 6 characters" />
            </div>
            <div className="form-row">
              <label className="label">Confirm Password</label>
              <input className="input" type="password" value={form.confirm} onChange={set("confirm")} placeholder="Repeat password" />
            </div>
          </div>

          <button type="submit" className="btn btn-primary" style={{ width: "100%", marginTop: 8 }} disabled={loading}>
            {loading ? "Submitting..." : "Submit for Approval"}
          </button>
        </form>

        <p style={styles.backLink}>
          <Link to="/" style={{ fontSize: 13, color: "#4f46e5" }}>
            ← Back to Login
          </Link>
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
    overflowY: "auto",
    padding: "24px 0",
  },
  card: {
    background: "#fff",
    borderRadius: 16,
    padding: 32,
    width: 460,
    boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
  },
  title: { textAlign: "center", fontSize: 22, marginBottom: 6, color: "#1e293b" },
  subtitle: { textAlign: "center", color: "#64748b", fontSize: 13, marginBottom: 20, lineHeight: 1.6 },
  muted: { lineHeight: 1.7, fontSize: 14, marginBottom: 12, color: "#475569", textAlign: "center" },
  check: {
    width: 56,
    height: 56,
    borderRadius: "50%",
    background: "#10b981",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 28,
    fontWeight: 700,
    margin: "0 auto 16px",
  },
  fullBtn: { width: "100%", marginTop: 8, display: "block" },
  backLink: { textAlign: "center", marginTop: 16 },
};