import React, { useEffect, useState } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { Toaster, toast } from "react-hot-toast";
import { AuthProvider, useAuth } from "./services/auth.jsx";
import { checkServerHealth } from "./services/api";
import { appTitle } from "./utils/branding";

import { useSubmissionSync } from "./hooks/useSubmissionSync";
import Login from "./pages/Login";
import StudentDashboard from "./pages/StudentDashboard";
import ExamPortal from "./pages/ExamPortal";
import StudentResults from "./pages/StudentResults";
import AdminDashboard from "./pages/AdminDashboard";
import TestBuilder from "./pages/TestBuilder";
import TestResults from "./pages/TestResults";
import SettingsPage from "./pages/SettingsPage";
import RegisterPage from "./pages/RegisterPage";
import SuperAdminDashboard from "./pages/SuperAdminDashboard";

function ProtectedRoute({ children, role }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/" />;
  if (role && user.role !== role) return <Navigate to="/" />;
  return children;
}

function DeactivatedScreen() {
  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#f8fafc",
        padding: 24,
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: "50%",
          background: "#fee2e2",
          color: "#dc2626",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 36,
          marginBottom: 16,
        }}
      >
        !
      </div>
      <h2 style={{ marginBottom: 8 }}>Account Deactivated</h2>
      <p style={{ maxWidth: 420, color: "#64748b", lineHeight: 1.7, marginBottom: 24 }}>
        This account has been deactivated. Please contact the platform service
        owner to request reactivation. You'll be able to log in again once the
        account is activated.
      </p>
    </div>
  );
}

function DirectedRoot() {
  const { user } = useAuth();
  if (user.role === "super_admin") return <Navigate to="/super" />;
  if (user.role === "admin") return <Navigate to="/admin" />;
  return <Navigate to="/student" />;
}

function ServerStatusBar() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const check = async () => {
      try {
        const healthy = await checkServerHealth();
        setOnline(healthy);
      } catch {
        setOnline(false);
      }
    };
    check();
    const interval = setInterval(check, 60000);
    return () => clearInterval(interval);
  }, []);
  if (online) return null;
  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        background: "#fef3c7",
        color: "#92400e",
        padding: "8px",
        textAlign: "center",
        fontSize: 13,
        zIndex: 9999,
        fontWeight: 500,
      }}
    >
      ⚠ Offline mode — you can still view cached tests. Submissions will sync when
      connected.
    </div>
  );
}

function AppContent() {
  const { user } = useAuth();
  const navigate = useNavigate();
  useSubmissionSync();

  useEffect(() => {
    if (!user) navigate("/");
  }, [user, navigate]);

  useEffect(() => {
    document.title = appTitle(user);
  }, [user]);

  if (!user) return <Login />;
  if (user.isActive === false) return <DeactivatedScreen />;

  return (
    <>
      <Routes>
        <Route path="/" element={<DirectedRoot />} />
        <Route
          path="/student"
          element={
            <ProtectedRoute role="student">
              <StudentDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/student/results"
          element={
            <ProtectedRoute role="student">
              <StudentResults />
            </ProtectedRoute>
          }
        />
        <Route
          path="/exam/:testId"
          element={
            <ProtectedRoute role="student">
              <ExamPortal />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute role="admin">
              <AdminDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/test/:testId"
          element={
            <ProtectedRoute role="admin">
              <TestBuilder />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/results/:testId"
          element={
            <ProtectedRoute role="admin">
              <TestResults />
            </ProtectedRoute>
          }
        />
        <Route
          path="/super"
          element={
            <ProtectedRoute role="super_admin">
              <SuperAdminDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <SettingsPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
      <ServerStatusBar />
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="*" element={<AppContent />} />
      </Routes>
      <Toaster position="top-right" />
    </AuthProvider>
  );
}