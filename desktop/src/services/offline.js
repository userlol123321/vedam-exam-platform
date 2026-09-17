// Offline storage via electron-store (persisted on disk) with fallback to localStorage

const DB_KEY = "vedam_offline_db";

async function getStore() {
  if (window.electronAPI?.storeGet) {
    const existing = await window.electronAPI.storeGet(DB_KEY);
    return existing || {};
  }
  try {
    return JSON.parse(localStorage.getItem(DB_KEY) || "{}");
  } catch {
    return {};
  }
}

async function saveStore(data) {
  if (window.electronAPI?.storeSet) {
    await window.electronAPI.storeSet(DB_KEY, data);
    return;
  }
  localStorage.setItem(DB_KEY, JSON.stringify(data));
}

export async function storeData(key, value) {
  const store = await getStore();
  store[key] = value;
  await saveStore(store);
}

export async function getData(key) {
  const store = await getStore();
  return store[key];
}

export async function removeData(key) {
  const store = await getStore();
  delete store[key];
  await saveStore(store);
}

export async function clearAll() {
  if (window.electronAPI?.storeDelete) {
    await window.electronAPI.storeDelete(DB_KEY);
  }
  localStorage.removeItem(DB_KEY);
}

// ---- Exam state persistence ----
// Save draft answers as the student works (survives crash/reboot)
export async function saveExamDraft(testId, draft) {
  await storeData(`exam_draft_${testId}`, draft);
}

export async function getExamDraft(testId) {
  return getData(`exam_draft_${testId}`);
}

export async function clearExamDraft(testId) {
  await removeData(`exam_draft_${testId}`);
}

// Pending submissions to sync when online
export async function queueSubmission(sub) {
  const pending = (await getData("pending_submissions")) || [];
  pending.push({ ...sub, queuedAt: new Date().toISOString() });
  await storeData("pending_submissions", pending);
}

export async function getPendingSubmissions() {
  return (await getData("pending_submissions")) || [];
}

export async function removePendingSubmission(index) {
  const pending = (await getData("pending_submissions")) || [];
  pending.splice(index, 1);
  await storeData("pending_submissions", pending);
}