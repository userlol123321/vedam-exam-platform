const { contextBridge, ipcRenderer } = require("electron");

// Expose safe APIs to the renderer process
contextBridge.exposeInMainWorld("electronAPI", {
  // Anti-cheating
  enterFullscreen: () => ipcRenderer.invoke("enter-fullscreen"),
  exitFullscreen: () => ipcRenderer.invoke("exit-fullscreen"),
  setExamMode: (enabled) => ipcRenderer.invoke("set-exam-mode", enabled),

  // Local storage (persisted via electron-store)
  storeGet: (key) => ipcRenderer.invoke("store-get", key),
  storeSet: (key, value) => ipcRenderer.invoke("store-set", key, value),
  storeDelete: (key) => ipcRenderer.invoke("store-delete", key),

  // Platform info
  getPlatform: () => ipcRenderer.invoke("get-platform"),
});