// Google Gemini Code Execution runner — a numpy/pandas-capable Python sandbox.
//
// The Gemini API's built-in `code_execution` tool runs Python in Google's
// Colab-backed sandbox, which pre-installs numpy, pandas, matplotlib, scipy,
// sklearn, sympy, tensorflow, etc. It has a FREE tier (Google AI Studio API
// key, no credit card), so it's a zero-cost fallback for questions whose
// primary judge lacks these libraries (e.g. onlinecompiler.io has only stdlib).
//
// Docs: https://ai.google.dev/gemini-api/docs/code-execution
// Key:  https://aistudio.google.com/apikey  ->  GEMINI_API_KEY
//
// Only Python is supported (Gemini executes Python only).

const API_BASE = (process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
const API_KEY = process.env.GEMINI_API_KEY || "";
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const REQUEST_TIMEOUT_MS = 80000; // 30s sandbox cap + model turn + overhead

const STATUS = {
  ACCEPTED: 3,
  RUNTIME_ERROR_OTHER: 12,
  INTERNAL_ERROR: 13,
};

function configured() {
  return Boolean(API_KEY);
}

function providerName() {
  return `Google Gemini (${MODEL})`;
}

function supports(language) {
  return language === "python";
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

/**
 * True when a run + code looks like it failed because the primary Python
 * runtime is missing third-party libraries (e.g. numpy/pandas) — the case we
 * retry through Gemini. Ordinary bugs (tracebacks, wrong answers) don't match.
 */
function shouldRetry(run, language = "python") {
  if (language !== "python" || !run) return false;
  const hay = `${String(run.stderr || "")} ${String(run.compileOutput || "")} ${String(run.message || "")}`;
  const trimmed = hay.trim().toLowerCase();
  if (/import error|importerror|no module named|module not found/.test(trimmed)) return true;
  // onlinecompiler.io sandbox-level crash when a module is missing
  if (String(run.stderr || "").trim().toLowerCase() === "internal error: code execution failed") return true;
  return false;
}

function buildPrompt(code, stdin) {
  return [
    "Run the Python program below EXACTLY as written. Do not modify, fix, refactor, or explain it.",
    "Feed this exact text as the program's standard input (stdin) when you run it:",
    "```\n" + String(stdin ?? "") + "\n```",
    "```python",
    String(code ?? ""),
    "```",
    "Reply with ONLY the program's real stdout and stderr, nothing else.",
  ].join("\n");
}

/**
 * Execute a single Python program via the Gemini code execution tool.
 * Returns a Judge0-shaped object so the grading pipeline works unchanged.
 */
async function runGemini({ language, code, stdin, timeLimitMs, memoryLimitMb }) {
  if (!configured()) {
    return internalError("Google Gemini runner is not configured: set GEMINI_API_KEY");
  }
  if (language !== "python") {
    return internalError(`Google Gemini only executes Python (got: ${language})`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    let res;
    try {
      res = await fetch(`${API_BASE}/models/${MODEL}:generateContent?key=${encodeURIComponent(API_KEY)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(code, stdin) }] }],
          tools: [{ code_execution: {} }],
          generationConfig: { temperature: 0 },
        }),
        signal: controller.signal,
      });
    } catch (err) {
      return internalError(err.name === "AbortError"
        ? `${providerName()} request timed out after ${REQUEST_TIMEOUT_MS}ms`
        : `${providerName()} network error: ${err.message}`);
    }

    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (e) {
      data = { raw: text.slice(0, 300) };
    }

    if (!res.ok) {
      const msg = String(data.error?.message || data.raw || `HTTP ${res.status}`).slice(0, 300);
      return internalError(`${providerName()} error ${res.status}: ${msg}`);
    }

    const parts = (data.candidates?.[0]?.content?.parts || []).filter((p) =>
      p.codeExecutionResult || p.executableCode
    );

    // Prefer the sandbox execution result emitted by the tool.
    const execResult = parts.find((p) => p.codeExecutionResult)?.codeExecutionResult;
    if (execResult && execResult.outcome === "OUTCOME_OK") {
      return {
        status: STATUS.ACCEPTED,
        statusDescription: "Accepted",
        stdout: String(execResult.output || ""),
        stderr: "",
        compileOutput: "",
        message: "",
        exitCode: 0,
      };
    }
    if (execResult && execResult.outcome === "OUTCOME_FAILED") {
      return {
        status: STATUS.RUNTIME_ERROR_OTHER,
        statusDescription: "Runtime Error",
        stdout: "",
        stderr: String(execResult.output || ""),
        compileOutput: "",
        message: "",
        exitCode: 1,
      };
    }

    return internalError(`${providerName()} did not execute the code (no sandbox result returned)`);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { runGemini, configured, providerName, supports, shouldRetry, STATUS };