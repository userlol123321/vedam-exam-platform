const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Judge0-compatible status ids so grading logic works unchanged.
const STATUS = {
  ACCEPTED: 3,
  TIME_LIMIT_EXCEEDED: 5,
  COMPILATION_ERROR: 6,
  RUNTIME_ERROR_OTHER: 12,
  INTERNAL_ERROR: 13,
};

const MAX_OUTPUT_BYTES = 1024 * 1024; // 1 MB stdout/stderr cap

function which(cmd) {
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], {
    stdio: "ignore",
  });
  return probe.status === 0;
}

function runtimeFor(language) {
  if (language === "python") {
    if (which("python3")) return { cmd: "python3", ext: "py", kind: "script" };
    if (which("python")) return { cmd: "python", ext: "py", kind: "script" };
    return null;
  }
  if (language === "javascript") {
    return { cmd: process.execPath, ext: "js", kind: "script" };
  }
  if (language === "java") {
    if (which("javac") && which("java")) return { cmd: "java", ext: "java", kind: "java" };
    return null;
  }
  return null;
}

// Wrap a command so the child gets address-space + cpu limits on POSIX.
// On Windows we fall back to a plain spawn (timeout still enforced in JS).
function wrapWithLimits(cmd, args, memoryLimitMb) {
  if (process.platform === "win32") return { cmd, args };
  const quoted = [cmd, ...args].map((a) => `'${String(a).replace(/'/g, `'\\''`)}'`).join(" ");
  const kb = Math.max(64, Number(memoryLimitMb) || 256) * 1024;
  return { cmd: "sh", args: ["-c", `ulimit -v ${kb} 2>/dev/null; exec ${quoted}`] };
}

function execWithLimits(cmd, args, stdin, timeLimitMs, memoryLimitMb) {
  return new Promise((resolve) => {
    const { cmd: realCmd, args: realArgs } = wrapWithLimits(cmd, args, memoryLimitMb);
    const child = spawn(realCmd, realArgs, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let killedByTimeout = false;
    let killedByMemory = false;

    const timer = setTimeout(() => {
      killedByTimeout = true;
      try { child.kill("SIGKILL"); } catch (e) {}
    }, Math.max(500, Number(timeLimitMs) || 2000));

    child.stdout.on("data", (d) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += d.toString("utf8");
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        status: STATUS.INTERNAL_ERROR,
        statusDescription: "Internal Error",
        stdout: "",
        stderr: "",
        compileOutput: "",
        message: err.message,
        exitCode: null,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (killedByTimeout) {
        return resolve({
          status: STATUS.TIME_LIMIT_EXCEEDED,
          statusDescription: "Time Limit Exceeded",
          stdout: stdout.trimEnd(),
          stderr: "",
          compileOutput: "",
          message: "Time limit exceeded",
          exitCode: code,
        });
      }
      // Heuristic: memory-limit kills surface as SIGSEGV/abort or ulimit failure.
      if (code !== 0 && /out of memory|cannot allocate|memory exhausted/i.test(stderr)) {
        killedByMemory = true;
      }
      resolve({
        status: code === 0 ? STATUS.ACCEPTED : STATUS.RUNTIME_ERROR_OTHER,
        statusDescription: code === 0 ? "Accepted" : killedByMemory ? "Memory Limit Exceeded" : "Runtime Error",
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
        compileOutput: "",
        message: "",
        exitCode: code,
      });
    });

    if (stdin) child.stdin.write(String(stdin));
    child.stdin.end();
  });
}

/**
 * Execute a single program against one stdin input using local runtimes.
 * Returns the same shape as the Judge0 executeCode().
 */
async function runLocal({ language, code, stdin, timeLimitMs, memoryLimitMb }) {
  const rt = runtimeFor(language);
  if (!rt) {
    return {
      status: STATUS.INTERNAL_ERROR,
      statusDescription: "Internal Error",
      stdout: "",
      stderr: "",
      compileOutput: "",
      message: `Runtime for '${language}' is not installed on this server`,
      exitCode: null,
    };
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vejudge-"));
  try {
    if (rt.kind === "java") {
      const file = path.join(tmp, "Main.java");
      fs.writeFileSync(file, String(code ?? ""));
      const compile = spawnSync("javac", [file], { cwd: tmp, encoding: "utf8", timeout: 20000 });
      if (compile.status !== 0) {
        return {
          status: STATUS.COMPILATION_ERROR,
          statusDescription: "Compilation Error",
          stdout: "",
          stderr: "",
          compileOutput: (compile.stderr || compile.stdout || "Compilation failed").trim(),
          message: "",
          exitCode: compile.status,
        };
      }
      return await execWithLimits(
        "java",
        ["-cp", tmp, "Main"],
        stdin,
        timeLimitMs,
        memoryLimitMb
      );
    }

    const file = path.join(tmp, `main.${rt.ext}`);
    fs.writeFileSync(file, String(code ?? ""));
    const args = rt.cmd === process.execPath ? [`--max-old-space-size=${Math.max(64, Number(memoryLimitMb) || 256)}`, file] : [file];
    return await execWithLimits(rt.cmd, args, stdin, timeLimitMs, memoryLimitMb);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
}

let runtimesCache = null;
function availableRuntimes() {
  if (runtimesCache) return runtimesCache;
  runtimesCache = {
    python: Boolean(runtimeFor("python")),
    javascript: Boolean(runtimeFor("javascript")),
    java: Boolean(runtimeFor("java")),
  };
  return runtimesCache;
}

module.exports = { runLocal, STATUS, runtimeFor, availableRuntimes };
