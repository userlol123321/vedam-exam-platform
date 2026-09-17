const express = require("express");
const { pool } = require("../config/database");
const { requireAuth, requireSuperAdmin } = require("../middleware/auth");

const router = express.Router();

// All routes here require super_admin role.

// GET /api/super/institutions - list all institutions with counts + status + admin
router.get("/institutions", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT i.id, i.name, i.code, i.created_at,
        (SELECT COUNT(*) FROM users u WHERE u.institution_id = i.id AND u.role = 'student') AS student_count,
        (SELECT COUNT(*) FROM users u WHERE u.institution_id = i.id AND u.role = 'admin') AS admin_count,
        (
          SELECT json_build_object(
            'id', a.id,
            'firstName', a.first_name,
            'lastName', a.last_name,
            'email', a.email,
            'isActive', a.is_active
          )
          FROM users a WHERE a.institution_id = i.id AND a.role = 'admin'
          ORDER BY a.created_at LIMIT 1
        ) AS admin
       FROM institutions i
       ORDER BY i.created_at DESC`
    );

    res.json({
      institutions: result.rows.map((r) => ({
        id: r.id,
        name: r.name,
        code: r.code,
        createdAt: r.created_at,
        studentCount: Number(r.student_count),
        adminCount: Number(r.admin_count),
        admin: r.admin,
        active: !!r.admin?.is_active,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/super/institutions/:id - full detail: admins + students + batches
router.get("/institutions/:id", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const instRes = await pool.query(
      `SELECT id, name, code, created_at FROM institutions WHERE id = $1`,
      [req.params.id]
    );
    if (instRes.rows.length === 0)
      return res.status(404).json({ error: "Institution not found" });
    const inst = instRes.rows[0];

    const adminsRes = await pool.query(
      `SELECT id, first_name, last_name, email, is_active, created_at
       FROM users WHERE institution_id = $1 AND role = 'admin' ORDER BY created_at`,
      [req.params.id]
    );

    const studentsRes = await pool.query(
      `SELECT u.id, u.first_name, u.last_name, u.enrollment_number, u.email, u.is_active, u.created_at, b.name AS batch_name
       FROM users u LEFT JOIN batches b ON u.batch_id = b.id
       WHERE u.institution_id = $1 AND u.role = 'student'
       ORDER BY u.created_at DESC`,
      [req.params.id]
    );

    const batchesRes = await pool.query(
      `SELECT b.id, b.name,
        (SELECT COUNT(*) FROM users u WHERE u.batch_id = b.id AND u.role='student') AS student_count
       FROM batches b WHERE b.institution_id = $1 ORDER BY b.name`,
      [req.params.id]
    );

    res.json({
      institution: { id: inst.id, name: inst.name, code: inst.code, createdAt: inst.created_at },
      admins: adminsRes.rows,
      students: studentsRes.rows,
      batches: batchesRes.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/super/institutions/:id/activate - activate admin account(s) (== approve institution)
router.post("/institutions/:id/activate", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    await pool.query(
      `UPDATE users SET is_active = TRUE
       WHERE institution_id = $1 AND role = 'admin'`,
      [req.params.id]
    );
    res.json({ activated: true, message: "Institution approved and admin activated" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/super/institutions/:id/deactivate - deactivate all admins of institution
router.post("/institutions/:id/deactivate", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    await pool.query(
      `UPDATE users SET is_active = FALSE
       WHERE institution_id = $1 AND role = 'admin'`,
      [req.params.id]
    );
    res.json({ deactivated: true, message: "Institution deactivated" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/super/users/:id/activate - activate any user (admin or student)
router.post("/users/:id/activate", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE users SET is_active = TRUE WHERE id = $1 RETURNING id, role, is_active`,
      [req.params.id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "User not found" });
    res.json({ activated: true, user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE /api/super/institutions/:id - permanently remove a college
// Deletes its tests/questions/submissions/results, students, admins and batches.
// The platform's own institution (code PLATFORM) can never be deleted.
router.delete("/institutions/:id", requireAuth, requireSuperAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const check = await client.query(
      `SELECT code FROM institutions WHERE id = $1`,
      [req.params.id]
    );
    if (check.rows.length === 0)
      return res.status(404).json({ error: "Institution not found" });
    if (check.rows[0].code === "PLATFORM") {
      return res.status(400).json({ error: "The platform institution cannot be deleted" });
    }

    await client.query("BEGIN");

    // Remove tests first so results_published.published_by no longer references users.
    await client.query(`DELETE FROM tests WHERE institution_id = $1`, [req.params.id]);
    // Batches (users.batch_id is SET NULL on delete, then users are removed too).
    await client.query(`DELETE FROM batches WHERE institution_id = $1`, [req.params.id]);
    // All accounts: students + admins.
    await client.query(`DELETE FROM users WHERE institution_id = $1`, [req.params.id]);
    // Finally the institution itself.
    const removed = await client.query(
      `DELETE FROM institutions WHERE id = $1 AND code <> 'PLATFORM' RETURNING id`,
      [req.params.id]
    );

    await client.query("COMMIT");

    res.json({ deleted: true, id: Number(req.params.id) });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(err);
    res.status(500).json({ error: "Server error while removing institution" });
  } finally {
    client.release();
  }
});

// POST /api/super/users/:id/deactivate - deactivate any user
router.post("/users/:id/deactivate", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    // Never deactivate super_admin accounts
    const check = await pool.query(`SELECT role FROM users WHERE id = $1`, [req.params.id]);
    if (check.rows.length === 0)
      return res.status(404).json({ error: "User not found" });
    if (check.rows[0].role === "super_admin") {
      return res.status(400).json({ error: "Cannot deactivate a platform owner account" });
    }
    const result = await pool.query(
      `UPDATE users SET is_active = FALSE WHERE id = $1 RETURNING id, role, is_active`,
      [req.params.id]
    );
    res.json({ deactivated: true, user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/super/stats - platform-wide overview
router.get("/stats", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const institutions = await pool.query(`SELECT COUNT(*) FROM institutions WHERE code <> 'PLATFORM'`);
    const pending = await pool.query(
      `SELECT COUNT(*) FROM users WHERE role = 'admin' AND is_active = FALSE`
    );
    const active = await pool.query(`SELECT COUNT(*) FROM users WHERE role = 'admin' AND is_active = TRUE`);
    const students = await pool.query(`SELECT COUNT(*) FROM users WHERE role = 'student'`);
    const activeStudents = await pool.query(`SELECT COUNT(*) FROM users WHERE role = 'student' AND is_active = TRUE`);
    const inactiveStudents = await pool.query(`SELECT COUNT(*) FROM users WHERE role = 'student' AND is_active = FALSE`);
    const tests = await pool.query(`SELECT COUNT(*) FROM tests`);
    const submissions = await pool.query(`SELECT COUNT(*) FROM submissions`);

    res.json({
      stats: {
        institutions: Number(institutions.rows[0].count),
        pendingInstitutions: Number(pending.rows[0].count),
        activeInstitutions: Number(active.rows[0].count),
        totalStudents: Number(students.rows[0].count),
        activeStudents: Number(activeStudents.rows[0].count),
        inactiveStudents: Number(inactiveStudents.rows[0].count),
        totalTests: Number(tests.rows[0].count),
        totalSubmissions: Number(submissions.rows[0].count),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;