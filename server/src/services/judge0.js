const JUDGE0_STATUS = {
  IN_QUEUE: 1,
  PROCESSING: 2,
  ACCEPTED: 3,
  WRONG_ANSWER: 4,
  TIME_LIMIT_EXCEEDED: 5,
  COMPILATION_ERROR: 6,
  RUNTIME_ERROR_SIGSEGV: 7,
  RUNTIME_ERROR_SIGXFSZ: 8,
  RUNTIME_ERROR_SIGFPE: 9,
  RUNTIME_ERROR_SIGABRT: 10,
  RUNTIME_ERROR_NZEC: 11,
  RUNTIME_ERROR_OTHER: 12,
  INTERNAL_ERROR: 13,
  EXEC_FORMAT_ERROR: 14,
};

const LANGUAGE_IDS = {
  python: { id: 71 },
  java: { id: 62 },
  javascript: { id: 63 },
};

const { runLocal, runtimeFor } = require("./localRunner");
const onlineRunner = require("./onlineRunner");
const geminiRunner = require("./geminiRunner");
const { fetchDataset } = require("./datasetFetcher");

const JUDGE0_MODE = process.env.JUDGE0_MODE || "CLOUD";
const JUDGE0_BASE_URL = process.env.JUDGE0_BASE_URL || "http://localhost:2358";
const JUDGE0_RAPID_API_KEY = process.env.JUDGE0_RAPID_API_KEY || "";
const JUDGE0_RAPID_HOST =
  process.env.JUDGE0_RAPID_HOST || "judge0-ce.p.rapidapi.com";

function getJudge0Config() {
  if (JUDGE0_MODE === "SELF_HOSTED") {
    return {
      baseUrl: JUDGE0_BASE_URL,
      headers: { "Content-Type": "application/json" },
    };
  }
  return {
    baseUrl: "https://judge0-ce.p.rapidapi.com",
    headers: {
      "Content-Type": "application/json",
      "X-RapidAPI-Key": JUDGE0_RAPID_API_KEY,
      "X-RapidAPI-Host": JUDGE0_RAPID_HOST,
    },
  };
}

function checkRestrictions(code, bannedPatterns = []) {
  if (!bannedPatterns || bannedPatterns.length === 0) return { violation: false };
  const source = String(code);
  for (const pattern of bannedPatterns) {
    if (!pattern) continue;
    try {
      // Attempt regex first; fall back to literal substring
      const re = new RegExp(pattern);
      if (re.test(source)) return { violation: true, pattern };
    } catch (err) {
      if (source.includes(pattern)) return { violation: true, pattern };
    }
  }
  return { violation: false };
}

function normalizeOutput(output) {
  if (output === null || output === undefined) return "";
  return String(output).replace(/\r\n/g, "\n").replace(/\s+$/, "").trim();
}

function outputsMatch(actual, expected) {
  return normalizeOutput(actual) === normalizeOutput(expected);
}

function b64(str) {
  return Buffer.from(str || "", "utf8").toString("base64");
}

function unb64(b) {
  if (!b) return "";
  try {
    return Buffer.from(b, "base64").toString("utf8");
  } catch (err) {
    return "";
  }
}

/**
 * Execute a single program against one stdin input.
 *
 * Mode routing:
 *  - LOCAL:  built-in localRunner only (no key/Docker needed)
 *  - HYBRID: local runtime first, fall back to the online compiler for
 *            languages without a local runtime (e.g. Java on Render native)
 *  - ONLINE: route coding execution through onlinecompiler.io for every
 *            supported language. Exception: JavaScript has no Node runtime on
 *            onlinecompiler.io (only TypeScript/Deno), so Node runs locally —
 *            it's just a child process of the server, zero extra footprint.
 *  - SELF_HOSTED / CLOUD: Judge0-compatible API
 *
 * `apiKeys` (optional): student-provided bring-your-own-key overrides,
 * e.g. `{ onlineCompiler: "...", gemini: "..." }`. Absent or empty = use the
 * platform's configured keys.
 */
async function executeCode({ language, code, stdin, timeLimitMs, memoryLimitMb, apiKeys = {} }) {
  const lang = LANGUAGE_IDS[language];
  if (!lang) throw new Error(`Unsupported language: ${language}`);

  let run;

  // Built-in judge: run code with local runtimes (no API key / Docker needed).
  if (JUDGE0_MODE === "LOCAL") {
    run = await runLocal({ language, code, stdin, timeLimitMs, memoryLimitMb });
  }

  // Local-first, online fallback for languages missing a local runtime.
  else if (JUDGE0_MODE === "HYBRID") {
    if (runtimeFor(language)) {
      run = await runLocal({ language, code, stdin, timeLimitMs, memoryLimitMb });
    } else if (onlineRunner.supports(language)) {
      run = await onlineRunner.runOnline({ language, code, stdin, timeLimitMs, memoryLimitMb, apiKey: apiKeys.onlineCompiler });
    } else {
      const err = new Error(
        `No runtime available for '${language}' (local or online) on this server`
      );
      err.status = 200;
      throw err;
    }
  }

  // Everything through the online compiler.
  else if (JUDGE0_MODE === "ONLINE") {
    // onlinecompiler.io has no Node runtime, so Node keeps running locally —
    // it's just a child process of the server (zero extra footprint).
    if (language === "javascript") {
      run = await runLocal({ language, code, stdin, timeLimitMs, memoryLimitMb });
    } else {
      run = await onlineRunner.runOnline({ language, code, stdin, timeLimitMs, memoryLimitMb, apiKey: apiKeys.onlineCompiler });
    }
  }

  // SELF_HOSTED / CLOUD: Judge0-compatible API.
  else {
    const cfg = getJudge0Config();

    const body = {
      source_code: b64(code),
      language_id: lang.id,
      stdin: b64(stdin),
      cpu_time_limit: (timeLimitMs || 2000) / 1000,
      memory_limit: memoryLimitMb || 256,
      base64_encoded: true,
    };

    const res = await fetch(
      `${cfg.baseUrl}/submissions?base64_encoded=true&wait=true`,
      {
        method: "POST",
        headers: cfg.headers,
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Judge0 error ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = await res.json();

    run = {
      status: data.status?.id,
      statusDescription: data.status?.description,
      stdout: unb64(data.stdout),
      stderr: unb64(data.stderr),
      compileOutput: unb64(data.compile_output),
      message: data.message ? unb64(data.message) : "",
      exitCode: data.exit_code,
      time: data.time,
      memory: data.memory,
    };
  }

  // numpy/pandas & friends: when the primary Python runtime lacks the needed
  // libraries, retry through Google Gemini's sandbox (free tier) for free.
  if (language === "python" && (geminiRunner.configured() || apiKeys.gemini) && geminiRunner.shouldRetry(run)) {
    const alt = await geminiRunner.runGemini({ language, code, stdin, timeLimitMs, memoryLimitMb, apiKey: apiKeys.gemini });
    if (alt) run = alt;
  }

  return run;
}

/**
 * Grade a coding question submission.
 * Handles: restriction violations, partial/all-or-nothing marking,
 * hidden test case weights, TLE/MLE/compile/runtime errors.
 */
async function gradeCodingQuestion({
  code,
  language,
  testCases,
  weights,
  timeLimitMs,
  memoryLimitMb,
  bannedPatterns,
  markingMode = "partial",
  apiKeys = {},
}) {
  const restrictionCheck = checkRestrictions(code, bannedPatterns);

  // Restriction violation = hard fail (0 marks), do not even run code
  if (restrictionCheck.violation) {
    const totalWeight = weights.reduce((a, b) => a + (Number(b) || 0), 0);
    return {
      earnedMarks: 0,
      totalWeight,
      restrictionViolation: restrictionCheck.pattern,
      caseResults: (testCases || []).map((_, i) => ({
        index: i,
        passed: false,
        weight: weights[i] || 1,
        runStatus: "restriction_violation",
      })),
    };
  }

  const caseResults = [];
  let earnedMarks = 0;
  let allPassed = true;

  for (let i = 0; i < (testCases || []).length; i++) {
    const tc = testCases[i];
    const weight = Number(weights[i]) || 1;
    const result = { index: i, passed: false, weight };

    try {
      const run = await executeCode({
        language,
        code,
        stdin: String(tc.input ?? ""),
        timeLimitMs,
        memoryLimitMb,
        apiKeys,
      });

      result.runStatus = run.statusDescription || `Status ${run.status}`;

      if (run.status === JUDGE0_STATUS.ACCEPTED) {
        const passed = outputsMatch(run.stdout, tc.output);
        result.passed = passed;
        if (passed) earnedMarks += weight;
        else allPassed = false;
      } else {
        allPassed = false;
        result.error = run.stderr || run.compileOutput || run.message || "";
      }
    } catch (err) {
      allPassed = false;
      result.error = err.message;
      result.runStatus = "judge_error";
    }

    caseResults.push(result);
  }

  const totalWeight = weights.reduce((a, b) => a + (Number(b) || 0), 0);

  if (markingMode === "all_or_nothing") {
    return {
      earnedMarks: allPassed && earnedMarks > 0 ? totalWeight : 0,
      totalWeight,
      caseResults,
    };
  }

  return { earnedMarks, totalWeight, caseResults };
}

// Parse a numeric accuracy value out of program stdout. Accepts plain floats
// (0.94 / 94 / "Accuracy: 94.3%").
function parseAccuracy(stdout) {
  const text = String(stdout || "");
  const matches = text.match(/-?\d+(\.\d+)?/g) || [];
  if (matches.length === 0) return null;
  const values = matches.map(Number);
  return { rawNumbers: values, mean: values.reduce((a, b) => a + b, 0) / values.length };
}

// Grade a Machine-Learning accuracy question. The admin supplies a dataset URL
// and an acceptable accuracy range; the student's code reads the dataset from
// stdin, trains/evaluates, and prints an accuracy value. Correct if the printed
// accuracy lands within [accuracyMin, accuracyMax].
async function gradeMLQuestion({
  code,
  datasetUrl,
  accuracyMin,
  accuracyMax,
  timeLimitMs,
  memoryLimitMb,
  bannedPatterns,
  markingMode = "all_or_nothing",
  apiKeys = {},
}) {
  const restrictionCheck = checkRestrictions(code, bannedPatterns);
  if (restrictionCheck.violation) {
    return {
      earnedMarks: 0,
      totalWeight: 1,
      restrictionViolation: restrictionCheck.pattern,
      caseResults: [{ index: 0, passed: false, runStatus: "restriction_violation" }],
    };
  }

  let dataset;
  try {
    ({ content: dataset } = await fetchDataset(datasetUrl));
  } catch (err) {
    return {
      earnedMarks: 0,
      totalWeight: 1,
      caseResults: [{
        index: 0,
        passed: false,
        runStatus: "dataset_error",
        error: err.message,
      }],
    };
  }

  const caseResults = [];
  let earnedMarks = 0;
  let result = { index: 0, passed: false, weight: 1 };

  try {
    const run = await executeCode({
      language: "python",
      code,
      stdin: dataset,
      timeLimitMs,
      memoryLimitMb,
      apiKeys,
    });

    result.runStatus = run.statusDescription || `Status ${run.status}`;
    if (run.status === JUDGE0_STATUS.ACCEPTED) {
      const parsed = parseAccuracy(run.stdout);
      const within = parsed && parsed.rawNumbers.some(
        (v) => v >= Number(accuracyMin) && v <= Number(accuracyMax)
      );
      result.passed = !!within;
      result.accuracy = parsed ? parsed.rawNumbers[parsed.rawNumbers.length - 1] : null;
      result.stdoutPreview = String(run.stdout || "").slice(0, 400);
      if (within) earnedMarks += 1;
    } else {
      result.error = run.stderr || run.compileOutput || run.message || "";
    }
  } catch (err) {
    result.error = err.message;
    result.runStatus = "judge_error";
  }

  caseResults.push(result);

  const allPassed = result.passed;
  const totalWeight = 1;
  if (markingMode === "all_or_nothing") {
    return { earnedMarks: allPassed ? totalWeight : 0, totalWeight, caseResults };
  }
  return { earnedMarks, totalWeight, caseResults };
}

/**
 * Mode-aware capability report for /health.
 */
function judgeStatus() {
  const mode = JUDGE0_MODE;
  const runtimes = { python: false, javascript: false, java: false };

  for (const language of Object.keys(LANGUAGE_IDS)) {
    if (mode === "LOCAL") {
      runtimes[language] = Boolean(runtimeFor(language));
    } else if (mode === "HYBRID") {
      runtimes[language] = Boolean(runtimeFor(language)) ||
        (onlineRunner.supports(language) && onlineRunner.configured());
    } else if (mode === "ONLINE") {
      // JavaScript always runs via local Node (onlinecompiler.io has none).
      runtimes[language] = language === "javascript"
        ? Boolean(runtimeFor(language))
        : onlineRunner.supports(language) && onlineRunner.configured();
    } else {
      // SELF_HOSTED / CLOUD rely on the Judge0-compatible API
      runtimes[language] = true;
    }
  }

  const judge = { mode, runtimes };
  if (mode === "HYBRID" || mode === "ONLINE") {
    judge.online = {
      provider: onlineRunner.providerName(),
      configured: onlineRunner.configured(),
      languages: Object.keys(LANGUAGE_IDS).filter(
        (l) => onlineRunner.supports(l) && (mode === "ONLINE" || !runtimeFor(l))
      ),
    };
  }
  judge.gemini = {
    provider: geminiRunner.providerName(),
    configured: geminiRunner.configured(),
  };
  return judge;
}

module.exports = {
  JUDGE0_STATUS,
  LANGUAGE_IDS,
  executeCode,
  checkRestrictions,
  gradeCodingQuestion,
  gradeMLQuestion,
  normalizeOutput,
  outputsMatch,
  judgeStatus,
};
