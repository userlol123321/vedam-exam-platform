// Online code runner (onlinecompiler.io) — powers HYBRID mode (for languages
// without a local runtime, e.g. Java on Render's native Node instance) and
// ONLINE mode (all coding execution routed through the cloud sandbox).
//
// onlinecompiler.io: free up to 1M requests/month, no credit card.
// Sign up at https://api.onlinecompiler.io -> API Keys, then set
// ONLINE_COMPILER_API_KEY. See https://www.onlinecompiler.io/docs
// Note: no Node/JavaScript compiler is offered (only TypeScript/Deno), so
// javascript always falls back to the local Node child process.

const API_BASE = process.env.ONLINE_COMPILER_BASE_URL || "https://api.onlinecompiler.io";
const API_KEY = process.env.ONLINE_COMPILER_API_KEY || "";
const REQUEST_TIMEOUT_MS = 45000; // service has a 30s execution cap + overhead

// Judge0-compatible status ids so grading logic works unchanged.
const STATUS = {
  ACCEPTED: 3,
  TIME_LIMIT_EXCEEDED: 5,
  COMPILATION_ERROR: 6,
  RUNTIME_ERROR_OTHER: 12,
  INTERNAL_ERROR: 13,
};

// compiler identifiers for the onlinecompiler.io run-code-sync endpoint.
const COMPILERS = {
  java: "openjdk-25",
  python: "python-3.14",
  // javascript has no Node compiler on onlinecompiler.io (only TypeScript/Deno),
  // so it's intentionally left unmapped — Node always runs locally.
  javascript: null,
};

function configured() {
  return Boolean(API_KEY);
}

function providerName() {
  return "onlinecompiler.io";
}

function supports(language) {
  return Boolean(COMPILERS[language]);
}

function internalError(message) {
  return {
    status: STATUS.INTERNAL_ERROR,
    statusDescription: "Internal Error",
    stdout: "",
    stderr: "",
    compileOutput: "",
    message,
    exitCode: null,
  };
}

function isCompileError(text) {
  return /\.java:\d+|error:\s+while\s+compiling|compilation failed|compiler.*error|Invalid\s+source|cannot find symbol|illegal start of expression/i.test(text);
}

function isTimeout(text) {
  return /timeout|timed out|time limit|sigtstp|sigkill|execution\,.*exceeded|exceeded.*time/i.test(text);
}

/**
 * Execute a single program against one stdin input using onlinecompiler.io.
 * Never throws for non-fatal provider issues — returns a Judge0-shaped object
 * so the grading pipeline in judge0.js works unchanged.
 */
async function runOnline({ language, code, stdin, timeLimitMs, memoryLimitMb }) {
  if (!configured()) {
    return internalError(
      `Online code runner (${providerName()}) is not configured: set ONLINE_COMPILER_API_KEY`
    );
  }
  const compiler = COMPILERS[language];
  if (!compiler) {
    return internalError(`No online compiler configured for language: ${language}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    let res;
    try {
      res = await fetch(`${API_BASE}/api/run-code-sync/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: API_KEY,
        },
        body: JSON.stringify({
          compiler,
          code: String(code ?? ""),
          input: String(stdin ?? ""),
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === "AbortError") {
        return internalError(`${providerName()} request timed out after ${REQUEST_TIMEOUT_MS}ms`);
      }
      return internalError(`${providerName()} network error: ${err.message}`);
    }

    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (e) {
      data = { error: text.slice(0, 300) };
    }

    if (!res.ok) {
      const msg = `${providerName()} HTTP ${res.status}: ${data.error || data.detail || text.slice(0, 300)}`;
      return res.status === 400 ? internalError(msg) : internalError(msg);
    }

    const exitOk = String(data.exit_code ?? "") === "0";
    const out = String(data.output ?? "");
    const errText = String(data.error ?? "") + " " + String(data.signal ?? "");

    if (exitOk && !errText.trim()) {
      return {
        status: STATUS.ACCEPTED,
        statusDescription: "Accepted",
        stdout: out,
        stderr: "",
        compileOutput: "",
        message: "",
        exitCode: 0,
      };
    }

    const trimErr = errText.trim();
    if (isTimeout(trimErr)) {
      return {
        status: STATUS.TIME_LIMIT_EXCEEDED,
        statusDescription: "Time Limit Exceeded",
        stdout: out,
        stderr: "",
        compileOutput: "",
        message: "Time limit exceeded",
        exitCode: 1,
      };
    }

    if (isCompileError(trimErr)) {
      return {
        status: STATUS.COMPILATION_ERROR,
        statusDescription: "Compilation Error",
        stdout: "",
        stderr: "",
        compileOutput: trimErr,
        message: "",
        exitCode: 1,
      };
    }

    return {
      status: STATUS.RUNTIME_ERROR_OTHER,
      statusDescription: "Runtime Error",
      stdout: out,
      stderr: trimErr,
      compileOutput: "",
      message: "",
      exitCode: 1,
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { runOnline, configured, providerName, supports, STATUS };