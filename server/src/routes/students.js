const express = require("express");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const { pool } = require("../config/database");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const MAX_PASSWORD_LENGTH = 72;
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET /api/admin/batches
router.get("/batches", requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.*,
        (SELECT COUNT(*) FROM users u WHERE u.batch_id = b.id AND u.role = 'student') AS student_count
       FROM batches b
       WHERE b.institution_id = $1
       ORDER BY b.name`,
      [req.user.institutionId]
    );
    res.json({ batches: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/batches
router.post("/batches", requireAuth, requireAdmin, async (req, res) => {
  const { name } = req.body;
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: "Batch name is required" });
  }
  try {
    const existing = await pool.query(
      `SELECT * FROM batches WHERE institution_id = $1 AND LOWER(name) = LOWER($2)`,
      [req.user.institutionId, String(name).trim()]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "A batch with this name already exists" });
    }
    const result = await pool.query(
      `INSERT INTO batches (institution_id, name) VALUES ($1, $2) RETURNING *`,
      [req.user.institutionId, String(name).trim()]
    );
    res.status(201).json({ batch: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE /api/admin/batches/:id
router.delete("/batches/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM batches WHERE id = $1 AND institution_id = $2 RETURNING id`,
      [req.params.id, req.user.institutionId]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Batch not found" });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/admin/students?batchId=X
router.get("/students", requireAuth, requireAdmin, async (req, res) => {
  const { batchId } = req.query;
  try {
    let query = `SELECT id, first_name, last_name, enrollment_number, email, batch_id, is_active, created_at
                 FROM users WHERE institution_id = $1 AND role = 'student'`;
    const params = [req.user.institutionId];
    if (batchId) {
      query += ` AND batch_id = $2 ORDER BY last_name, first_name`;
      params.push(batchId);
    } else {
      query += ` ORDER BY batch_id NULLS LAST, last_name, first_name`;
    }
    const result = await pool.query(query, params);
    res.json({ students: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/students - single add
router.post("/students", requireAuth, requireAdmin, async (req, res) => {
  const { firstName, lastName, enrollmentNumber, password, batchId, email } = req.body;
  if (!firstName || !lastName || !enrollmentNumber || !password) {
    return res.status(400).json({
      error: "firstName, lastName, enrollmentNumber, and password required",
    });
  }
  if (String(password).length < 8 || String(password).length > MAX_PASSWORD_LENGTH) {
    return res.status(400).json({
      error: "Password must be 8-72 characters",
    });
  }
  if (email && !emailRe.test(String(email))) {
    return res.status(400).json({ error: "Invalid email address" });
  }
  try {
    if (batchId) {
      const batchRes = await pool.query(
        `SELECT id FROM batches WHERE id = $1 AND institution_id = $2`,
        [batchId, req.user.institutionId]
      );
      if (batchRes.rows.length === 0)
        return res.status(400).json({ error: "Invalid batch" });
    }

    const hash = await bcrypt.hash(String(password), 10);
    const result = await pool.query(
      `INSERT INTO users
        (institution_id, role, first_name, last_name, enrollment_number, email, password_hash, batch_id)
       VALUES ($1, 'student', $2, $3, $4, $5, $6, $7)
       RETURNING id, first_name, last_name, enrollment_number, batch_id`,
      [
        req.user.institutionId,
        String(firstName).trim(),
        String(lastName).trim(),
        String(enrollmentNumber).trim(),
        email ? String(email).trim().toLowerCase() : null,
        hash,
        batchId || null,
      ]
    );
    res.status(201).json({ student: result.rows[0] });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        error: "A student with this enrollment number already exists",
      });
    }
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/students/bulk - CSV upload
router.post(
  "/students/bulk",
  requireAuth,
  requireAdmin,
  upload.single("file"),
  async (req, res) => {
    const { batchId } = req.body;

    if (!req.file) return res.status(400).json({ error: "CSV file is required" });
    if (!batchId) return res.status(400).json({ error: "batchId is required" });

    try {
      const batchRes = await pool.query(
        `SELECT id, name FROM batches WHERE id = $1 AND institution_id = $2`,
        [batchId, req.user.institutionId]
      );
      if (batchRes.rows.length === 0)
        return res.status(400).json({ error: "Invalid batch" });

      const csvText = req.file.buffer.toString("utf8");
      const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) return res.status(400).json({ error: "CSV is empty" });

      let startIdx = 0;
      if (/first|last|enroll|batch|pass|email/i.test(lines[0])) startIdx = 1;

      const parsed = [];
      for (let i = startIdx; i < lines.length; i++) {
        const parts = lines[i].split(",").map((p) => p.trim());
        if (parts.length < 3) continue;
        parsed.push({
          firstName: parts[0],
          lastName: parts[1] || "",
          enrollmentNumber: parts[2],
          password: parts[3] || null,
          email: parts[4] || null,
        });
      }

      if (parsed.length === 0)
        return res.status(400).json({ error: "No valid student rows found" });

      const errors = [];
      let created = 0;
      for (const s of parsed) {
        try {
          if (!s.firstName || !s.enrollmentNumber) {
            errors.push(`Skipped row missing name/enrollment`);
            continue;
          }
          // Never silently assign a shared default password.
          if (!s.password || String(s.password).length < 8) {
            errors.push(
              `Skipped ${s.enrollmentNumber}: a password of 8+ characters is required in the CSV`
            );
            continue;
          }
          if (s.email && !emailRe.test(String(s.email))) {
            errors.push(`Skipped ${s.enrollmentNumber}: invalid email`);
            continue;
          }
          const hash = await bcrypt.hash(String(s.password).slice(0, MAX_PASSWORD_LENGTH), 10);
          await pool.query(
            `INSERT INTO users
              (institution_id, role, first_name, last_name, enrollment_number, email, password_hash, batch_id)
             VALUES ($1, 'student', $2, $3, $4, $5, $6, $7)`,
            [
              req.user.institutionId,
              s.firstName,
              s.lastName,
              s.enrollmentNumber,
              s.email,
              hash,
              batchId,
            ]
          );
          created++;
        } catch (err) {
          if (err.code === "23505") {
            errors.push(`Duplicate enrollment: ${s.enrollmentNumber}`);
          } else {
            errors.push(`Error importing ${s.enrollmentNumber}: ${err.message}`);
          }
        }
      }

      res.json({
        total: parsed.length,
        created,
        errors,
        batchName: batchRes.rows[0].name,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

// GET /api/admin/export-template
router.get("/export-template", requireAuth, requireAdmin, (req, res) => {
  const csv =
    "first_name,last_name,enrollment_number,password,email\n" +
    "Rahul,Sharma,CS2401,rahul@123456,rahul@example.com\n" +
    "Priya,Patel,CS2402,priya@123456,priya@example.com\n";
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=students-template.csv");
  res.send(csv);
});

// DELETE /api/admin/students/:id
router.delete("/students/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM users WHERE id = $1 AND institution_id = $2 RETURNING id`,
      [req.params.id, req.user.institutionId]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Student not found" });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// PATCH /api/admin/students/:id - toggle active, reset password
router.patch("/students/:id", requireAuth, requireAdmin, async (req, res) => {
  const { isActive, password } = req.body;
  try {
    const sets = [];
    const params = [];
    if (typeof isActive === "boolean") {
      params.push(isActive);
      sets.push(`is_active = $${params.length}`);
    }
    if (password) {
      const hash = await bcrypt.hash(String(password), 10);
      params.push(hash);
      sets.push(`password_hash = $${params.length}`);
    }
    if (sets.length === 0) return res.status(400).json({ error: "No fields to update" });

    params.push(req.params.id, req.user.institutionId);
    const result = await pool.query(
      `UPDATE users SET ${sets.join(", ")}
       WHERE id = $${params.length - 1} AND institution_id = $${params.length}
       RETURNING id`,
      params
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Student not found" });
    res.json({ updated: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;