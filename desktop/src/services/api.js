import axios from "axios";

// Base URL: env override → saved server URL → default localhost.
// Prefers localStorage (sync, available in renderer) over electron-store (async IPC).
const API_BASE =
  import.meta.env.VITE_API_URL ||
  localStorage.getItem("vedam_server_url") ||
  "http://localhost:5001";

export const api = axios.create({
  baseURL: `${API_BASE}/api`,
  timeout: 120000,
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

// Student bring-your-own-key (BYOK) storage. Keys stay on the student's own
// machine and are sent with each code run/submit so the student pays for their
// own execution quota. Never uploaded anywhere else.
const KEYS_LS_KEY = "vedam_student_keys";

export function getStudentKeys() {
  try {
    return JSON.parse(localStorage.getItem(KEYS_LS_KEY) || "{}");
  } catch {
    return {};
  }
}

export function saveStudentKeys(keys) {
  const clean = {};
  if (keys.onlineCompiler) clean.onlineCompiler = String(keys.onlineCompiler).trim();
  if (keys.gemini) clean.gemini = String(keys.gemini).trim();
  localStorage.setItem(KEYS_LS_KEY, JSON.stringify(clean));
  return clean;
}

export function clearStudentKeys() {
  localStorage.removeItem(KEYS_LS_KEY);
}

export { API_BASE };