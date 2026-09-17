import axios from "axios";

// Base URL: env override → saved server URL → default localhost.
// Prefers localStorage (sync, available in renderer) over electron-store (async IPC).
const API_BASE =
  import.meta.env.VITE_API_URL ||
  localStorage.getItem("vedam_server_url") ||
  "http://localhost:5001";

export const api = axios.create({
  baseURL: `${API_BASE}/api`,
  timeout: 60000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("vedam_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("vedam_token");
      localStorage.removeItem("vedam_user");
    }
    return Promise.reject(err);
  }
);

// Offline-safe request: try network, fall back to stored response if online check fails
export async function requestWithOffline(method, url, body, offlineKey) {
  try {
    const res = await api[method](url, body);
    if (offlineKey) await storeData(offlineKey, res.data);
    return { online: true, data: res.data };
  } catch (err) {
    // Check if offline or a real error
    if (offlineKey && !navigator.onLine) {
      const cached = await getData(offlineKey);
      if (cached) return { online: false, data: cached };
    }
    throw err;
  }
}

export async function checkServerHealth() {
  try {
    const res = await api.get("/health", { timeout: 5000 });
    return res.data.status === "ok";
  } catch {
    return false;
  }
}

export { API_BASE };