const express = require("express");
const { pool } = require("../config/database");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();

// GET /api/admin/results/:testId - analytics dashboard for a test
router.get("/:testId", requireAuth, requireAdmin, async (req, res) => {
  try {
    const testRes = await pool.query(
      `SELECT t.*, b.name AS batch_name
       FROM tests t LEFT JOIN batches b ON t.batch_id = b.id
       WHERE t.id = $1 AND t.institution_id = $2`,
      [req.params.testId, req.user.institutionId]
    );
    if (testRes.rows.length === 0)
      return res.status(404).json({ error: "Test not found" });
    const test = testRes.rows[0];

    // Overall stats
    const statsRes = await pool.query(
      `SELECT
        COUNT(*) AS total_submissions,
        COALESCE(AVG(score), 0) AS avg_score,
        COALESCE(MAX(score), 0) AS max_score,
        COALESCE(MIN(score), 0) AS min_score,
        COALESCE(SUM(CASE WHEN score >= (SELECT COALESCE(AVG(score2),1) FROM submissions score2 WHERE score2.test_id = s.test_id) THEN 1 ELSE 0 END), 0) AS above_avg
       FROM submissions s WHERE s.test_id = $1 AND s.is_graded = TRUE`,
      [req.params.testId]
    );

    // Pass rate = score >= 50% of total
    const passRateRes = await pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE score >= total_marks * 0.5) AS passed,
        COUNT(*) AS total
       FROM submissions WHERE test_id = $1 AND is_graded = TRUE`,
      [req.params.testId]
    );

    // Score distribution buckets (0-20%, 20-40%, 40-60%, 60-80%, 80-100%)
    const distRes = await pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE total_marks > 0 AND score / total_marks < 0.2) AS b_0_20,
        COUNT(*) FILTER (WHERE total_marks > 0 AND score / total_marks >= 0.2 AND score / total_marks < 0.4) AS b_20_40,
        COUNT(*) FILTER (WHERE total_marks > 0 AND score / total_marks >= 0.4 AND score / total_marks < 0.6) AS b_40_60,
        COUNT(*) FILTER (WHERE total_marks > 0 AND score / total_marks >= 0.6 AND score / total_marks < 0.8) AS b_60_80,
        COUNT(*) FILTER (WHERE total_marks > 0 AND score / total_marks >= 0.8) AS b_80_100
       FROM submissions WHERE test_id = $1 AND is_graded = TRUE`,
      [req.params.testId]
    );

    // Per-question analysis
    const perQuestionRes = await pool.query(
      `SELECT q.id, q.type, q.marks, q.order_index,
              COUNT(gd.id) AS attempts,
              COALESCE(AVG(CASE WHEN gd.earned_marks > 0 THEN 1 ELSE 0 END), 0) AS success_rate,
              COALESCE(AVG(gd.earned_marks), 0) AS avg_earned
       FROM questions q
       LEFT JOIN grading_details gd ON gd.question_id = q.id
       WHERE q.test_id = $1
       GROUP BY q.id, q.type, q.marks, q.order_index
       ORDER BY q.order_index`,
      [req.params.testId]
    );

    // Per-student results
    const studentsRes = await pool.query(
      `SELECT u.id, u.first_name, u.last_name, u.enrollment_number, u.batch_id,
              s.score, s.total_marks, s.submitted_at, s.duration_seconds, s.tab_switches,
              s.started_at
       FROM submissions s
       JOIN users u ON s.student_id = u.id
       WHERE s.test_id = $1 AND s.is_graded = TRUE
       ORDER BY s.score DESC`,
      [req.params.testId]
    );

    // Tab-switch violations (>= 5 switches flagged)
    const violations = studentsRes.rows.filter((s) => s.tab_switches >= 5);

    res.json({
      test: {
        id: test.id,
        title: test.title,
        batchName: test.batch_name,
        resultsVisibility: test.results_visibility,
      },
      stats: {
        totalSubmissions: Number(statsRes.rows[0].total_submissions),
        avgScore: Number(statsRes.rows[0].avg_score).toFixed(2),
        maxScore: Number(statsRes.rows[0].max_score),
        minScore: Number(statsRes.rows[0].min_score),
        passed: Number(passRateRes.rows[0].passed),
        passRate: statsRes.rows[0].total_submissions > 0
          ? ((Number(passRateRes.rows[0].passed) / Number(statsRes.rows[0].total_submissions)) * 100).toFixed(1)
          : 0,
      },
      distribution: {
        buckets: {
          "0-20%": Number(distRes.rows[0].b_0_20),
          "20-40%": Number(distRes.rows[0].b_20_40),
          "40-60%": Number(distRes.rows[0].b_40_60),
          "60-80%": Number(distRes.rows[0].b_60_80),
          "80-100%": Number(distRes.rows[0].b_80_100),
        },
      },
      perQuestion: perQuestionRes.rows.map((q) => ({
        id: q.id,
        type: q.type,
        marks: q.marks,
        orderIndex: q.order_index,
        attempts: Number(q.attempts),
        successRate: (Number(q.success_rate) * 100).toFixed(1),
        avgEarned: Number(q.avg_earned).toFixed(2),
      })),
      students: studentsRes.rows.map((s) => ({
        id: s.id,
        name: `${s.first_name} ${s.last_name}`,
        enrollmentNumber: s.enrollment_number,
        score: Number(s.score),
        totalMarks: Number(s.total_marks),
        submittedAt: s.submitted_at,
        durationSeconds: s.duration_seconds,
        tabSwitches: s.tab_switches,
        flagged: s.tab_switches >= 5,
        percentage: s.total_marks > 0
          ? ((Number(s.score) / Number(s.total_marks)) * 100).toFixed(1)
          : 0,
      })),
      violations,
      isPublished: test.results_visibility === "visible",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/results/:testId/publish - make results visible to students
router.post("/:testId/publish", requireAuth, requireAdmin, async (req, res) => {
  try {
    const testRes = await pool.query(
      `SELECT id FROM tests WHERE id = $1 AND institution_id = $2`,
      [req.params.testId, req.user.institutionId]
    );
    if (testRes.rows.length === 0)
      return res.status(404).json({ error: "Test not found" });

    await pool.query(
      `UPDATE tests SET results_visibility = 'visible' WHERE id = $1`,
      [req.params.testId]
    );
    await pool.query(
      `INSERT INTO results_published (test_id, published_by)
       VALUES ($1, $2)
       ON CONFLICT (test_id) DO NOTHING`,
      [req.params.testId, req.user.id]
    );

    res.json({ published: true, message: "Results published to students" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/results/:testId/unpublish - hide results again
router.post("/:testId/unpublish", requireAuth, requireAdmin, async (req, res) => {
  try {
    const testRes = await pool.query(
      `SELECT id FROM tests WHERE id = $1 AND institution_id = $2`,
      [req.params.testId, req.user.institutionId]
    );
    if (testRes.rows.length === 0)
      return res.status(404).json({ error: "Test not found" });

    await pool.query(
      `UPDATE tests SET results_visibility = 'hidden' WHERE id = $1`,
      [req.params.testId]
    );
    await pool.query(
      `DELETE FROM results_published WHERE test_id = $1`,
      [req.params.testId]
    );

    res.json({ published: false, message: "Results hidden from students" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;