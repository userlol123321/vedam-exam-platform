import React, { createContext, useContext, useState } from "react";
import { api } from "../services/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("vedam_user") || "null");
    } catch {
      return null;
    }
  });
  const [token, setToken] = useState(localStorage.getItem("vedam_token") || null);
  const [loading, setLoading] = useState(false);

  async function login({ identifier, password, role }) {
    setLoading(true);
    try {
      const res = await api.post("/auth/login", { identifier, password, role });
      const { token: newToken, user: newUser } = res.data;
      localStorage.setItem("vedam_token", newToken);
      localStorage.setItem("vedam_user", JSON.stringify(newUser));
      setToken(newToken);
      setUser(newUser);
      return { ok: true, user: newUser };
    } catch (err) {
      const msg = err.response?.data?.error || "Login failed. Check server connection.";
      return { ok: false, error: msg };
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    localStorage.removeItem("vedam_token");
    localStorage.removeItem("vedam_user");
    setToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, token, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}