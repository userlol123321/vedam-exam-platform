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

const { runLocal } = require("./localRunner");

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
 */
async function executeCode({ language, code, stdin, timeLimitMs, memoryLimitMb }) {
  const lang = LANGUAGE_IDS[language];
  if (!lang) throw new Error(`Unsupported language: ${language}`);

  // Built-in judge: run code with local runtimes (no API key / Docker needed).
  if (JUDGE0_MODE === "LOCAL") {
    return runLocal({ language, code, stdin, timeLimitMs, memoryLimitMb });
  }

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

  return {
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

module.exports = {
  JUDGE0_STATUS,
  LANGUAGE_IDS,
  executeCode,
  checkRestrictions,
  gradeCodingQuestion,
  normalizeOutput,
  outputsMatch,
};