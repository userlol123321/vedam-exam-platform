const express = require("express");
const { pool } = require("../config/database");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const encryption = require("../services/encryption");

const router = express.Router();

function toPosInt(value, fallback, max = 10 ** 6) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > max) return fallback;
  return Math.round(n);
}
function toPosNum(value, fallback, max = 10 ** 6) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > max) return fallback;
  return n;
}

// POST /api/admin/tests - create a test
router.post("/", requireAuth, requireAdmin, async (req, res) => {
  const {
    title,
    description,
    batchId,
    availableFrom,
    availableUntil,
    durationMinutes,
    allowLateStart = true,
    allowRankView = false,
  } = req.body;

  if (!title || !batchId || !availableFrom || !availableUntil || !durationMinutes) {
    return res.status(400).json({
      error: "title, batchId, availableFrom, availableUntil, durationMinutes required",
    });
  }

  try {
    const batchRes = await pool.query(
      `SELECT id FROM batches WHERE id = $1 AND institution_id = $2`,
      [batchId, req.user.institutionId]
    );
    if (batchRes.rows.length === 0)
      return res.status(400).json({ error: "Invalid batch" });

    const from = new Date(availableFrom);
    const until = new Date(availableUntil);
    if (until <= from) {
      return res.status(400).json({
        error: "availableUntil must be after availableFrom",
      });
    }
    if (Number.isNaN(from.getTime()) || Number.isNaN(until.getTime())) {
      return res.status(400).json({ error: "Invalid dates" });
    }
    const duration = toPosInt(durationMinutes, 60, 24 * 60);

    const encryptionKey = encryption.generateTestKey();

    const result = await pool.query(
      `INSERT INTO tests
        (institution_id, batch_id, title, description, available_from, available_until,
         duration_minutes, allow_late_start, allow_rank_view, encryption_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, title, batch_id, available_from, available_until, duration_minutes,
                 allow_late_start, allow_rank_view`,
      [
        req.user.institutionId,
        batchId,
        String(title).trim(),
        description || "",
        from,
        until,
        duration,
        allowLateStart,
        allowRankView,
        encryptionKey,
      ]
    );

    res.status(201).json({ test: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/admin/tests - list all tests for admin's institution
router.get("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.id, t.title, t.description, t.batch_id, t.available_from, t.available_until,
              t.duration_minutes, t.allow_late_start, t.results_visibility, t.allow_rank_view,
              t.is_active, t.created_at, b.name AS batch_name,
              (SELECT COUNT(*) FROM questions q WHERE q.test_id = t.id) AS question_count,
              (SELECT COUNT(*) FROM submissions s WHERE s.test_id = t.id) AS submission_count,
              EXISTS (SELECT 1 FROM results_published rp WHERE rp.test_id = t.id) AS results_published
       FROM tests t
       LEFT JOIN batches b ON t.batch_id = b.id
       WHERE t.institution_id = $1
       ORDER BY t.available_from DESC`,
      [req.user.institutionId]
    );
    res.json({ tests: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/admin/tests/:id - get one test with questions
router.get("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const testRes = await pool.query(
      `SELECT t.*, b.name AS batch_name
       FROM tests t LEFT JOIN batches b ON t.batch_id = b.id
       WHERE t.id = $1 AND t.institution_id = $2`,
      [req.params.id, req.user.institutionId]
    );
    if (testRes.rows.length === 0)
      return res.status(404).json({ error: "Test not found" });
    const test = testRes.rows[0];
    const key = test.encryption_key;
    delete test.encryption_key;

    const questionsRes = await pool.query(
      `SELECT id, type, question_text, options, correct_answer, marks, negative_marks,
              language, starter_code, complexity_requirement, input_constraints,
              banned_patterns, restrict_msg, time_limit_ms, memory_limit_mb,
              sample_test_cases, hidden_test_cases, marking_mode, order_index,
              ml_mode, dataset_url, accuracy_min, accuracy_max
       FROM questions WHERE test_id = $1 ORDER BY order_index`,
      [req.params.id]
    );

    // Decrypt question content for admin view
    const questions = questionsRes.rows.map((q) => ({
      ...q,
      question_text: encryption.decrypt(q.question_text, key),
      options: q.options ? encryption.decryptJson(q.options, key) : null,
      correct_answer: q.correct_answer ? encryption.decrypt(q.correct_answer, key) : null,
      starter_code: q.starter_code ? encryption.decrypt(q.starter_code, key) : null,
      sample_test_cases: q.sample_test_cases ? encryption.decryptJson(q.sample_test_cases, key) : null,
      hidden_test_cases: q.hidden_test_cases ? encryption.decryptJson(q.hidden_test_cases, key) : null,
    }));

    res.json({ test, questions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// PATCH /api/admin/tests/:id - update test settings
router.patch("/:id", requireAuth, requireAdmin, async (req, res) => {
  const { title, description, availableFrom, availableUntil, durationMinutes, allowLateStart, allowRankView, isActive } = req.body;
  try {
    const existing = await pool.query(
      `SELECT * FROM tests WHERE id = $1 AND institution_id = $2`,
      [req.params.id, req.user.institutionId]
    );
    if (existing.rows.length === 0)
      return res.status(404).json({ error: "Test not found" });

    const sets = [];
    const params = [];
    if (title) { params.push(String(title).trim()); sets.push(`title = $${params.length}`); }
    if (description !== undefined) { params.push(description); sets.push(`description = $${params.length}`); }
    if (availableFrom) {
      const f = new Date(availableFrom);
      if (Number.isNaN(f.getTime())) return res.status(400).json({ error: "Invalid availableFrom" });
      params.push(f); sets.push(`available_from = $${params.length}`);
    }
    if (availableUntil) {
      const u = new Date(availableUntil);
      if (Number.isNaN(u.getTime())) return res.status(400).json({ error: "Invalid availableUntil" });
      params.push(u); sets.push(`available_until = $${params.length}`);
    }
    if (durationMinutes) {
      const d = toPosInt(durationMinutes, null, 24 * 60);
      if (d === null) return res.status(400).json({ error: "Invalid duration" });
      params.push(d); sets.push(`duration_minutes = $${params.length}`);
    }
    if (typeof allowLateStart === "boolean") { params.push(allowLateStart); sets.push(`allow_late_start = $${params.length}`); }
    if (typeof allowRankView === "boolean") { params.push(allowRankView); sets.push(`allow_rank_view = $${params.length}`); }
    if (typeof isActive === "boolean") { params.push(isActive); sets.push(`is_active = $${params.length}`); }
    if (sets.length === 0) return res.status(400).json({ error: "No fields to update" });

    params.push(req.params.id, req.user.institutionId);
    const result = await pool.query(
      `UPDATE tests SET ${sets.join(", ")} WHERE id = $${params.length - 1} AND institution_id = $${params.length} RETURNING id`,
      params
    );
    res.json({ updated: true, id: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE /api/admin/tests/:id
router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM tests WHERE id = $1 AND institution_id = $2 RETURNING id`,
      [req.params.id, req.user.institutionId]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Test not found" });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/tests/:id/questions - add a question
router.post("/:id/questions", requireAuth, requireAdmin, async (req, res) => {
  const { type, ...data } = req.body;

  try {
    const testRes = await pool.query(
      `SELECT * FROM tests WHERE id = $1 AND institution_id = $2`,
      [req.params.id, req.user.institutionId]
    );
    if (testRes.rows.length === 0)
      return res.status(404).json({ error: "Test not found" });
    const key = testRes.rows[0].encryption_key;

    if (type === "mcq") {
      const { questionText, options = [], correctAnswer, marks = 1, negativeMarks = 0 } = data;
      if (!questionText || !correctAnswer || options.length < 2) {
        return res.status(400).json({
          error: "questionText, options (2+), and correctAnswer required for MCQ",
        });
      }
      const marksNum = toPosInt(marks, 1, 1000);
      const negNum = toPosNum(negativeMarks, 0, marksNum);
      const orderResult = await pool.query(
        `SELECT COALESCE(MAX(order_index), -1) + 1 AS next_order FROM questions WHERE test_id = $1`,
        [req.params.id]
      );
      const result = await pool.query(
        `INSERT INTO questions
          (test_id, type, question_text, options, correct_answer, marks, negative_marks, order_index)
         VALUES ($1, 'mcq', $2, $3, $4, $5, $6, $7)
         RETURNING id, type, marks`,
        [
          req.params.id,
          encryption.encrypt(String(questionText), key),
          encryption.encryptJson(options, key),
          encryption.encrypt(String(correctAnswer), key),
          marksNum,
          negNum || 0,
          orderResult.rows[0].next_order,
        ]
      );
      return res.status(201).json({ question: result.rows[0] });
    }

    if (type === "coding") {
      const {
        questionText,
        language,
        starterCode = "",
        complexityRequirement = "",
        inputConstraints = "",
        bannedPatterns = [],
        restrictMsg = "",
        timeLimitMs = 2000,
        memoryLimitMb = 256,
        sampleTestCases = [],
        hiddenTestCases = [],
        weights = [],
        markingMode = "partial",
        marks = 1,
        mlMode = false,
        datasetUrl = "",
        accuracyMin = null,
        accuracyMax = null,
      } = data;

      if (!questionText || !language) {
        return res.status(400).json({
          error: "questionText and language required",
        });
      }

      const isMl = Boolean(mlMode) || Boolean(datasetUrl);
      if (isMl) {
        if (language !== "python") {
          return res.status(400).json({ error: "ML questions must use Python" });
        }
        if (!datasetUrl) {
          return res.status(400).json({ error: "datasetUrl required for ML questions" });
        }
        if (datasetUrl.startsWith("http://")) {
          return res.status(400).json({ error: "Dataset URL must use https" });
        }
        if (accuracyMin === null || accuracyMax === null) {
          return res.status(400).json({ error: "accuracyMin and accuracyMax required for ML questions" });
        }
        if (Number(accuracyMax) < Number(accuracyMin)) {
          return res.status(400).json({ error: "accuracyMax must be >= accuracyMin" });
        }
      } else if (hiddenTestCases.length === 0) {
        return res.status(400).json({
          error: "at least one hiddenTestCase required unless ML question",
        });
      }

      const orderResult = await pool.query(
        `SELECT COALESCE(MAX(order_index), -1) + 1 AS next_order FROM questions WHERE test_id = $1`,
        [req.params.id]
      );

      const marksNum = toPosInt(marks, 1, 1000);
      const timeLimit = toPosInt(timeLimitMs, 2000, 60_000);
      const memoryLimit = toPosInt(memoryLimitMb, 256, 4096);
      const weightsNum = weights.map((w) => Math.max(0, Math.min(1000, Number(w) || 1)));

      // Encode test cases with keys for weight mapping
      const rawHidden = hiddenTestCases.map((tc, i) => ({
        input: tc.input !== undefined ? String(tc.input) : "",
        output: tc.output !== undefined ? String(tc.output) : "",
      }));
      const rawSample = sampleTestCases.map((tc) => ({
        input: tc.input !== undefined ? String(tc.input) : "",
        output: tc.output !== undefined ? String(tc.output) : "",
        explanation: tc.explanation || "",
      }));

      const result = await pool.query(
        `INSERT INTO questions
          (test_id, type, question_text, language, starter_code, complexity_requirement,
           input_constraints, banned_patterns, restrict_msg, time_limit_ms, memory_limit_mb,
           sample_test_cases, hidden_test_cases, marking_mode, marks, order_index,
           ml_mode, dataset_url, accuracy_min, accuracy_max)
         VALUES ($1, 'coding', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                 $16, $17, $18, $19)
         RETURNING id, type, marks`,
        [
          req.params.id,
          encryption.encrypt(String(questionText), key),
          language,
          encryption.encrypt(starterCode || "", key),
          complexityRequirement || "",
          inputConstraints || "",
          JSON.stringify(bannedPatterns || []),
          restrictMsg || "",
          timeLimit,
          memoryLimit,
          encryption.encryptJson(rawSample, key),
          encryption.encryptJson(rawHidden, key),
          markingMode,
          marksNum,
          orderResult.rows[0].next_order,
          Boolean(isMl),
          isMl ? String(datasetUrl).trim() : null,
          isMl && accuracyMin !== null ? Number(accuracyMin) : null,
          isMl && accuracyMax !== null ? Number(accuracyMax) : null,
        ]
      );

      const questionId = result.rows[0].id;

      // Store per-case weights
      for (let i = 0; i < rawHidden.length; i++) {
        const weight = Number(weightsNum[i]) || 1;
        await pool.query(
          `INSERT INTO test_case_weights (question_id, case_index, weight) VALUES ($1, $2, $3)`,
          [questionId, i, weight]
        );
      }

      return res.status(201).json({ question: result.rows[0] });
    }

    return res.status(400).json({ error: "Question type must be 'mcq' or 'coding'" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE /api/admin/questions/:id - delete a question
router.delete("/questions/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM questions WHERE id = $1
       AND test_id IN (SELECT id FROM tests WHERE institution_id = $2)
       RETURNING id`,
      [req.params.id, req.user.institutionId]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Question not found" });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;