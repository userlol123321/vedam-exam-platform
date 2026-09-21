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
const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const REQUEST_TIMEOUT_MS = 80000; // 30s sandbox cap + model turn + overhead

// Free-tier Gemini frequently returns 429 (rate limit) / 503 (high demand).
// Retry transient failures so a numpy/pandas grading pass doesn't fail on a blip.
const MAX_RETRIES = Number(process.env.GEMINI_API_RETRIES) || 3;

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
 *
 * `apiKey`: optional student-supplied key, overrides the platform key
 * (bring-your-own-key) so students can run numpy/pandas with their own quota.
 */
async function runGemini({ language, code, stdin, timeLimitMs, memoryLimitMb, apiKey }) {
  const key = String(apiKey || "").trim() || API_KEY;
  if (!key) {
    return internalError("Google Gemini runner has no API key: add your Gemini key in the exam app");
  }
  if (language !== "python") {
    return internalError(`Google Gemini only executes Python (got: ${language})`);
  }

  let lastResult = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      lastResult = await sendOnce({ code, stdin, controller, apiKey: key });
    } finally {
      clearTimeout(timer);
    }

    if (!lastResult.retryable || attempt >= MAX_RETRIES) break;
    await sleep((attempt + 1) * 1000); // backoff before the next attempt
  }

  return lastResult.judge;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendOnce({ code, stdin, controller, apiKey }) {
  let res;
  try {
    res = await fetch(`${API_BASE}/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, {
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
    return {
      retryable: err.name !== "AbortError",
      judge: internalError(err.name === "AbortError"
        ? `${providerName()} request timed out after ${REQUEST_TIMEOUT_MS}ms`
        : `${providerName()} network error: ${err.message}`),
    };
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
    return {
      retryable: res.status === 429 || res.status === 500 || res.status === 503 || res.status >= 502,
      judge: internalError(`${providerName()} error ${res.status}: ${msg}`),
    };
  }

  const parts = (data.candidates?.[0]?.content?.parts || []).filter((p) =>
    p.codeExecutionResult || p.executableCode
  );

  // Prefer the sandbox execution result emitted by the tool.
  const execResult = parts.find((p) => p.codeExecutionResult)?.codeExecutionResult;
  if (execResult && execResult.outcome === "OUTCOME_OK") {
    return {
      retryable: false,
      judge: {
        status: STATUS.ACCEPTED,
        statusDescription: "Accepted",
        stdout: String(execResult.output || ""),
        stderr: "",
        compileOutput: "",
        message: "",
        exitCode: 0,
      },
    };
  }
  if (execResult && execResult.outcome === "OUTCOME_FAILED") {
    return {
      retryable: false,
      judge: {
        status: STATUS.RUNTIME_ERROR_OTHER,
        statusDescription: "Runtime Error",
        stdout: "",
        stderr: String(execResult.output || ""),
        compileOutput: "",
        message: "",
        exitCode: 1,
      },
    };
  }

  return {
    retryable: false,
    judge: internalError(`${providerName()} did not execute the code (no sandbox result returned)`),
  };
}

module.exports = { runGemini, configured, providerName, supports, shouldRetry, STATUS };