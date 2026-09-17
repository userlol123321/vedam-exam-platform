const { app, BrowserWindow, ipcMain, globalShortcut, session } = require("electron");
const path = require("path");
const Store = require("electron-store");

const store = new Store();
const isDev = !app.isPackaged;

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    icon: path.join(__dirname, "../public/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    // Anti-cheating: remove title bar controls in exam mode (toggled later)
    autoHideMenuBar: true,
    titleBarStyle: "hiddenInset", // macOS native look
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  // Anti-cheating: prevent new windows (pop-ups, external links)
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  mainWindow.on("close", () => {
    mainWindow = null;
  });
}

// ===== ANTI-CHEATING: IPC HANDLERS =====

// Enter fullscreen (called when exam starts)
ipcMain.handle("enter-fullscreen", () => {
  if (mainWindow) {
    mainWindow.setFullScreen(true);
    mainWindow.setMenuBarVisibility(false);
  }
});

// Exit fullscreen (called when exam ends or submitting)
ipcMain.handle("exit-fullscreen", () => {
  if (mainWindow) {
    mainWindow.setFullScreen(false);
    mainWindow.setMenuBarVisibility(true);
  }
});

// Block keyboard shortcuts during exam (Ctrl+C, Ctrl+V, Ctrl+T, etc.)
let examMode = false;
ipcMain.handle("set-exam-mode", (event, enabled) => {
  examMode = enabled;
  if (enabled) {
    mainWindow.webContents.on("before-input-event", blockExamShortcuts);
    // Block copy/paste context menu
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ["*://*/clipboard-write"] },
      (details, callback) => callback({ cancel: true })
    );
  } else {
    mainWindow.webContents.removeListener("before-input-event", blockExamShortcuts);
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ["*://*/clipboard-write"] },
      (details, callback) => callback({ cancel: false })
    );
  }
});

function blockExamShortcuts(event, input) {
  if (!examMode) return;
  // Block: Ctrl+C, Ctrl+V, Ctrl+A, Ctrl+X, Ctrl+U, Ctrl+S, Ctrl+P, Ctrl+Shift+I, F12, Alt+Tab (limited)
  const blocked = [
    "c", "v", "a", "x", "u", "s", "p", "j" // Ctrl modifiers
  ];
  if (
    (input.control || input.meta) &&
    blocked.includes(input.key.toLowerCase())
  ) {
    event.preventDefault();
  }
  // Block F12 and Ctrl+Shift+I (DevTools)
  if (input.key === "F12") event.preventDefault();
  if (
    (input.control || input.meta) &&
    input.shift &&
    input.key.toLowerCase() === "i"
  ) {
    event.preventDefault();
  }
}

// Store/retrieve data locally (for offline support)
ipcMain.handle("store-get", (event, key) => store.get(key));
ipcMain.handle("store-set", (event, key, value) => store.set(key, value));
ipcMain.handle("store-delete", (event, key) => store.delete(key));

// Get platform info
ipcMain.handle("get-platform", () => ({
  platform: process.platform,
  isWindows: process.platform === "win32",
  isMac: process.platform === "darwin",
}));

// App lifecycle
app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}