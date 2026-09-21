const express = require("express");
const rateLimit = require("express-rate-limit");
const { pool } = require("../config/database");
const { requireAuth, requireStudent } = require("../middleware/auth");
const encryption = require("../services/encryption");
const { gradeCodingQuestion, executeCode } = require("../services/judge0");

const router = express.Router();

// How long after a test window ends we still accept offline submissions.
const LATE_SUBMIT_GRACE_MS = 2 * 60 * 60 * 1000; // 2 hours
const MAX_CODE_LENGTH = 500_000; // chars of code per coding answer
const MAX_ANSWERS = 500;

// Prevent using /code/run as a free code-execution service / DoS vector.
const codeRunLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many code runs. Please wait a moment." },
});

// Student bring-your-own-key (BYOK): keys override the platform keys so each
// student can pay for their own code-execution quota. Trimmed + length-capped.
function cleanApiKeys(raw = {}) {
  const keys = {};
  const oc = String(raw?.onlineCompiler || "").trim().slice(0, 300);
  const gm = String(raw?.gemini || "").trim().slice(0, 300);
  if (oc) keys.onlineCompiler = oc;
  if (gm) keys.gemini = gm;
  return keys;
}

// GET /api/student/tests - available tests for my batch (only those currently available by time)
router.get("/tests", requireAuth, requireStudent, async (req, res) => {
  try {
    const now = new Date();
    const result = await pool.query(
      `SELECT t.id, t.title, t.description, t.available_from, t.available_until,
              t.duration_minutes, t.allow_late_start, t.results_visibility, t.allow_rank_view,
              (SELECT COUNT(*) FROM questions q WHERE q.test_id = t.id) AS question_count,
              (SELECT COALESCE(MAX(q.marks), 0) FROM questions q WHERE q.test_id = t.id) AS total_marks,
              EXISTS (SELECT 1 FROM questions q WHERE q.test_id = t.id AND q.type = 'coding') AS has_coding,
              s.id AS submission_id, s.score, s.is_graded,
              s.started_at, s.submitted_at
       FROM tests t
       LEFT JOIN submissions s ON s.test_id = t.id AND s.student_id = $2
       WHERE t.institution_id = $1
         AND t.batch_id = $3
         AND t.is_active = TRUE
         AND t.available_from <= $4
       ORDER BY t.available_from`,
      [req.user.institutionId, req.user.id, req.user.batchId, now]
    );
    res.json({ tests: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/student/results - all PUBLISHED results for this student
router.get("/results", requireAuth, requireStudent, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.id AS test_id, t.title, t.available_from, t.available_until, t.allow_rank_view,
              s.score, s.total_marks, s.submitted_at, s.duration_seconds, s.tab_switches,
              rp.published_at,
              (SELECT COUNT(*) FROM grading_details gd WHERE gd.submission_id = s.id) AS graded_questions
       FROM submissions s
       JOIN tests t ON s.test_id = t.id
       JOIN results_published rp ON rp.test_id = t.id
       WHERE s.student_id = $1
       ORDER BY rp.published_at DESC`,
      [req.user.id]
    );
    res.json({ results: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/student/results/:testId - detailed result breakdown for one published test
router.get("/results/:testId", requireAuth, requireStudent, async (req, res) => {
  try {
    const published = await pool.query(
      `SELECT rp.published_at FROM results_published rp WHERE rp.test_id = $1`,
      [req.params.testId]
    );
    if (published.rows.length === 0)
      return res.status(403).json({ error: "Results not published yet" });

    const testRes = await pool.query(
      `SELECT t.*, b.name AS batch_name,
              (SELECT COUNT(*) FROM submissions s2 WHERE s2.test_id = t.id AND s2.is_graded) AS attempted
       FROM tests t LEFT JOIN batches b ON t.batch_id = b.id WHERE t.id = $1`,
      [req.params.testId]
    );
    if (testRes.rows.length === 0)
      return res.status(404).json({ error: "Test not found" });
    const test = testRes.rows[0];

    const subRes = await pool.query(
      `SELECT * FROM submissions WHERE test_id = $1 AND student_id = $2`,
      [req.params.testId, req.user.id]
    );
    if (subRes.rows.length === 0)
      return res.status(404).json({ error: "Submission not found" });
    const submission = subRes.rows[0];

    const gradingRes = await pool.query(
      `SELECT gd.*, q.type, q.marks, q.question_text, q.language,
              q.complexity_requirement, q.input_constraints, q.sample_test_cases, q.order_index
       FROM grading_details gd
       JOIN questions q ON gd.question_id = q.id
       WHERE gd.submission_id = $1
       ORDER BY q.order_index`,
      [submission.id]
    );

    // Rank within batch (if allow_rank_view)
    let rank = null;
    if (test.allow_rank_view) {
      const rankRes = await pool.query(
        `SELECT COUNT(*) + 1 AS rank FROM submissions
         WHERE test_id = $1 AND score > $2`,
        [req.params.testId, submission.score]
      );
      rank = rankRes.rows[0].rank;
    }

    const key = test.encryption_key;
    const questions = gradingRes.rows.map((g) => ({
      type: g.type,
      marks: g.marks,
      earnedMarks: Number(g.earned_marks),
      isCorrect: g.is_correct,
      caseResults: g.case_results,
      restrictionViolation: g.restriction_violation,
      details: g.details,
      question: encryption.decrypt(g.question_text, key),
      language: g.language,
      orderIndex: g.order_index,
    }));

    res.json({
      test: {
        id: test.id,
        title: test.title,
        batchName: test.batch_name,
        availableUntil: test.available_until,
      },
      submission: {
        score: submission.score,
        totalMarks: submission.total_marks,
        submittedAt: submission.submitted_at,
        durationSeconds: submission.duration_seconds,
        tabSwitches: submission.tab_switches,
      },
      rank,
      questions,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/student/tests/:id/start
// Returns: decryption session info + encrypted question bundle (small payload for slow networks)
// The encryption_key is delivered separately/on-demand to reduce offline risk.
// POST /api/student/tests/:id/start
router.post("/tests/:id/start", requireAuth, requireStudent, async (req, res) => {
  const apiKeys = cleanApiKeys(req.body.apiKeys);
  try {
    const now = new Date();
    const testRes = await pool.query(
      `SELECT * FROM tests WHERE id = $1 AND institution_id = $2 AND batch_id = $3 AND is_active = TRUE`,
      [req.params.id, req.user.institutionId, req.user.batchId]
    );
    if (testRes.rows.length === 0)
      return res.status(404).json({ error: "Test not found or not available for your batch" });

    const test = testRes.rows[0];

    // Check availability window
    if (now < new Date(test.available_from)) {
      return res.status(403).json({ error: "Test has not started yet" });
    }
    if (now > new Date(test.available_until)) {
      return res.status(403).json({ error: "Test window has ended" });
    }

    // Check existing submission (one attempt)
    const existing = await pool.query(
      `SELECT * FROM submissions WHERE test_id = $1 AND student_id = $2`,
      [req.params.id, req.user.id]
    );
    if (existing.rows.length > 0 && existing.rows[0].submitted_at) {
      return res.status(409).json({ error: "You have already submitted this test" });
    }

    // Create or reuse submission
    let submission;
    if (existing.rows.length > 0) {
      submission = existing.rows[0];
    } else {
      const created = await pool.query(
        `INSERT INTO submissions (test_id, student_id, started_at)
         VALUES ($1, $2, $3) RETURNING *`,
        [req.params.id, req.user.id, now]
      );
      submission = created.rows[0];
    }

    // Compute remaining time (late-start handling)
    const fullDurationMs = test.duration_minutes * 60 * 1000;
    const maxRemaining = new Date(test.available_until) - now;
    const remainingMs = test.allow_late_start
      ? Math.min(fullDurationMs, maxRemaining)
      : fullDurationMs;

    // Fetch questions (encrypted storage)
    const qRes = await pool.query(
      `SELECT * FROM questions WHERE test_id = $1 ORDER BY order_index`,
      [req.params.id]
    );

    // A coding exam requires the student's own execution API key
    // (bring-your-own-key), so the student pays for their runs — the platform
    // does not subsidize student code execution.
    const hasCoding = qRes.rows.some((q) => q.type === "coding");
    if (hasCoding && !apiKeys.onlineCompiler) {
      return res.status(400).json({
        error:
          "This test has coding questions. Add your onlinecompiler.io API key in the exam app to start.",
      });
    }

    const key = test.encryption_key;

    // Send bundle: encrypted questions + their len is tiny (mostly large blobs separated)
    const questions = qRes.rows.map((q) => {
      if (q.type === "mcq") {
        return {
          id: q.id,
          type: q.type,
          question_text: q.question_text,       // encrypted
          options: q.options,                    // encrypted JSON
          marks: q.marks,
          negative_marks: q.negative_marks,
        };
      }
      // coding
      const weightsRes = null;
      return {
        id: q.id,
        type: q.type,
        question_text: q.question_text,          // encrypted
        language: q.language,
        starter_code: q.starter_code,            // encrypted
        complexity_requirement: q.complexity_requirement,
        input_constraints: q.input_constraints,
        banned_patterns: q.banned_patterns,
        restrict_msg: q.restrict_msg,
        time_limit_ms: q.time_limit_ms,
        memory_limit_mb: q.memory_limit_mb,
        sample_test_cases: q.sample_test_cases,  // encrypted JSON
        marks: q.marks,
        marking_mode: q.marking_mode,
        order_index: q.order_index,
      };
    });

    // Weights fetched separately for the frontend to display possible total.
    const weightRes = await pool.query(
      `SELECT question_id, case_index, weight FROM test_case_weights
       WHERE question_id = ANY($1::int[])`,
      [qRes.rows.map((q) => q.id)]
    );
    const weightsByQuestion = {};
    for (const w of weightRes.rows) {
      if (!weightsByQuestion[w.question_id]) weightsByQuestion[w.question_id] = [];
      weightsByQuestion[w.question_id][w.case_index] = w.weight;
    }

    res.json({
      test: {
        id: test.id,
        title: test.title,
        description: test.description,
        durationMinutes: test.duration_minutes,
        allowLateStart: test.allow_late_start,
        availableUntil: test.available_until,
      },
      submission: {
        id: submission.id,
        startedAt: submission.started_at,
        remainingMs,
      },
      // Encryption key is delivered here — browser decrypts in memory only
      encryptionKey: key,
      questions,       // encrypted payload
      weights: weightsByQuestion,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/student/tests/:id/submit
router.post("/tests/:id/submit", requireAuth, requireStudent, async (req, res) => {
  const { answers, tabSwitches, apiKeys: rawKeys } = req.body;
  const apiKeys = cleanApiKeys(rawKeys);

  // Basic payload sanity. Answers are graded server-side against DB truth, so
  // a crafted payload cannot inflate marks — but guard sizes anyway.
  if (!Array.isArray(answers)) {
    return res.status(400).json({ error: "answers must be an array" });
  }
  if (answers.length > MAX_ANSWERS) {
    return res.status(400).json({ error: "Too many answers" });
  }
  const cleanTabSwitches = Math.max(0, Math.min(999, Number(tabSwitches) || 0));

  try {
    const subRes = await pool.query(
      `SELECT * FROM submissions WHERE test_id = $1 AND student_id = $2`,
      [req.params.id, req.user.id]
    );
    if (subRes.rows.length === 0)
      return res.status(404).json({ error: "Submission not found — start the test first" });
    if (subRes.rows[0].submitted_at)
      return res.status(409).json({ error: "Already submitted" });

    const testRes = await pool.query(
      `SELECT * FROM tests WHERE id = $1 AND institution_id = $2`,
      [req.params.id, req.user.institutionId]
    );
    if (testRes.rows.length === 0)
      return res.status(404).json({ error: "Test not found" });
    const test = testRes.rows[0];
    const key = test.encryption_key;

    const now = new Date();

    // Time-window enforcement. Students can submit a little late (offline sync)
    // but not indefinitely after the exam window closed.
    const windowEnd = new Date(test.available_until).getTime();
    if (now.getTime() > windowEnd + LATE_SUBMIT_GRACE_MS) {
      return res.status(403).json({
        error: "The test window ended. Contact your admin to accept this submission.",
      });
    }

    const startedAt = new Date(subRes.rows[0].started_at);
    const elapsedMs = Math.max(0, now - startedAt);
    // Never grant more than the test's own duration (counts downtime too),
    // but let offline syncs land within the grace window.
    const durationSeconds = Math.round(
      Math.min(elapsedMs, test.duration_minutes * 60 * 1000 + LATE_SUBMIT_GRACE_MS) / 1000
    );

    // Store answers
    const updated = await pool.query(
      `UPDATE submissions
       SET answers = $1, submitted_at = $2, duration_seconds = $3, tab_switches = $4
       WHERE id = $5 RETURNING id`,
      [JSON.stringify(answers), now, durationSeconds, cleanTabSwitches, subRes.rows[0].id]
    );

    // ---- Auto-grading ----
    const qRes = await pool.query(
      `SELECT * FROM questions WHERE test_id = $1 ORDER BY order_index`,
      [req.params.id]
    );
    const questions = qRes.rows;

    // Weight lookup
    const weightRes = await pool.query(
      `SELECT question_id, case_index, weight FROM test_case_weights
       WHERE question_id = ANY($1::int[])`,
      [questions.map((q) => q.id)]
    );
    const weightMap = {};
    for (const w of weightRes.rows) {
      if (!weightMap[w.question_id]) weightMap[w.question_id] = [];
      weightMap[w.question_id][w.case_index] = w.weight;
    }

    let totalScore = 0;
    let totalMarks = 0;

    for (const q of questions) {
      const answer = (answers || []).find((a) => a.questionId === q.id);
      const gd = { earnedMarks: 0, isCorrect: false };

      if (q.type === "mcq") {
        totalMarks += Number(q.marks) + (Number(q.negative_marks) || 0);
        const correctAnswer = encryption.decrypt(q.correct_answer, key);
        const chosen = answer?.answer;

        if (chosen && chosen === correctAnswer) {
          gd.earnedMarks = Number(q.marks);
          gd.isCorrect = true;
        } else {
          gd.earnedMarks = -(Number(q.negative_marks) || 0);
          gd.isCorrect = false;
        }
      } else if (q.type === "coding") {
        const hiddenCases = encryption.decryptJson(q.hidden_test_cases, key);
        const weights = weightMap[q.id] || hiddenCases.map(() => 1);
        const bannedPatterns = q.banned_patterns || [];
        const code = String(answer?.code || "").slice(0, MAX_CODE_LENGTH);

        const graded = await gradeCodingQuestion({
          code,
          language: q.language,
          testCases: hiddenCases,
          weights,
          timeLimitMs: q.time_limit_ms,
          memoryLimitMb: q.memory_limit_mb,
          bannedPatterns,
          markingMode: q.marking_mode,
          apiKeys,
        });

        gd.earnedMarks = graded.earnedMarks;
        gd.isCorrect = graded.earnedMarks > 0;
        gd.case_results = graded.caseResults;
        gd.restriction_violation = graded.restrictionViolation || null;
        gd.details = code.slice(0, 500) || null;

        // Scale the weighted result to the question's configured marks, so a
        // fully-correct coding answer is worth `marks` regardless of weight sum.
        const qMarks = Number(q.marks) || 0;
        const totalW = graded.totalWeight || 0;
        gd.earnedMarks = totalW > 0
          ? Number(((graded.earnedMarks / totalW) * qMarks).toFixed(2))
          : 0;
        totalMarks += qMarks;
      }

      totalScore += Number(gd.earnedMarks);

      await pool.query(
        `INSERT INTO grading_details
          (submission_id, question_id, earned_marks, is_correct, case_results, restriction_violation, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (submission_id, question_id)
         DO UPDATE SET earned_marks = $3, is_correct = $4, case_results = $5,
                       restriction_violation = $6, details = $7`,
        [
          subRes.rows[0].id,
          q.id,
          gd.earnedMarks,
          gd.isCorrect,
          JSON.stringify(gd.case_results || null),
          gd.restriction_violation,
          gd.details,
        ]
      );
    }

    const finalScore = Math.max(0, totalScore);
    await pool.query(
      `UPDATE submissions SET score = $1, total_marks = $2, is_graded = TRUE WHERE id = $3`,
      [finalScore, totalMarks, subRes.rows[0].id]
    );

    res.json({
      submitted: true,
      score: finalScore,
      totalMarks,
      message: "Test submitted successfully",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/code/run - live "Run" during exam (sample cases only)
router.post("/code/run", codeRunLimiter, requireAuth, requireStudent, async (req, res) => {
  const { language, code, stdin, testId, apiKeys: rawKeys } = req.body;
  const apiKeys = cleanApiKeys(rawKeys);
  try {
    // Only allow running code while an exam for the student's batch is in progress.
    const now = new Date();
    const active = await pool.query(
      `SELECT id FROM tests
       WHERE id = $1 AND institution_id = $2 AND batch_id = $3 AND is_active = TRUE
         AND available_from <= $4 AND available_until >= $4
       LIMIT 1`,
      [testId, req.user.institutionId, req.user.batchId, now]
    );
    if (active.rows.length === 0) {
      return res.status(403).json({ error: "No active test for code execution" });
    }

    const codeStr = String(code || "").slice(0, 100_000);
    const stdinStr = String(stdin || "").slice(0, 4_000);

    const run = await executeCode({
      language,
      code: codeStr,
      stdin: stdinStr,
      timeLimitMs: 2000,
      memoryLimitMb: 256,
      apiKeys,
    });
    res.json(run);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;