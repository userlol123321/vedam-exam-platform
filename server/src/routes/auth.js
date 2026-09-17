const express = require("express");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const { pool } = require("../config/database");
const { signToken, requireAuth } = require("../middleware/auth");

const router = express.Router();

const MAX_PASSWORD_LENGTH = 72; // bcrypt only uses the first 72 bytes

// Strict brute-force protection on the login + register endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Too many login attempts. Please try again in 15 minutes." },
});
router.use(authLimiter);

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const { identifier, password, role } = req.body;

  if (!identifier || !password) {
    return res.status(400).json({ error: "Identifier and password required" });
  }
  if (typeof password !== "string" || password.length > MAX_PASSWORD_LENGTH) {
    return res.status(400).json({ error: "Invalid password format" });
  }

  try {
    const requestedRole = role === "super_admin" ? "super_admin" : role === "admin" ? "admin" : "student";

    let query, params;
    if (requestedRole === "super_admin") {
      query = `SELECT * FROM users WHERE role = 'super_admin' AND email = $1`;
      params = [String(identifier).toLowerCase().trim()];
    } else if (requestedRole === "admin") {
      query = `SELECT * FROM users WHERE role = 'admin' AND email = $1`;
      params = [String(identifier).toLowerCase().trim()];
    } else {
      query = `SELECT * FROM users WHERE role = 'student' AND enrollment_number = $1`;
      params = [String(identifier).trim()];
    }

    const result = await pool.query(query, params);
    const user = result.rows[0];

    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    if (!user.is_active) {
      if (user.role === "super_admin") {
        return res.status(403).json({
          error: "This platform account is deactivated.",
          deactivated: true,
        });
      }
      const isInstitution = user.role === "admin";
      return res.status(403).json({
        error: isInstitution
          ? "Your institution account is deactivated. Contact the platform service owner for activation."
          : "Your account is deactivated. Contact your institution admin or the platform service owner for activation.",
        deactivated: true,
        role: user.role,
      });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    let batchName = null;
    if (user.batch_id) {
      const batchRes = await pool.query(`SELECT name FROM batches WHERE id = $1`, [user.batch_id]);
      batchName = batchRes.rows[0]?.name || null;
    }

    let institutionName = null;
    let institutionCode = null;
    if (user.institution_id) {
      const instRes = await pool.query(`SELECT name, code FROM institutions WHERE id = $1`, [user.institution_id]);
      institutionName = instRes.rows[0]?.name || null;
      institutionCode = instRes.rows[0]?.code || null;
    }

    const token = signToken(user);

    res.json({
      token,
      user: {
        id: user.id,
        role: user.role,
        firstName: user.first_name,
        lastName: user.last_name,
        enrollmentNumber: user.enrollment_number,
        email: user.email,
        batchId: user.batch_id,
        batchName,
        institutionId: user.institution_id,
        institutionName,
        institutionCode,
        isActive: user.is_active,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/auth/me
router.get("/me", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.*, b.name AS batch_name, i.name AS institution_name
       FROM users u
       LEFT JOIN batches b ON u.batch_id = b.id
       LEFT JOIN institutions i ON u.institution_id = i.id
       WHERE u.id = $1`,
      [req.user.id]
    );
    const u = result.rows[0];
    if (!u) return res.status(404).json({ error: "User not found" });

    res.json({
      user: {
        id: u.id,
        role: u.role,
        firstName: u.first_name,
        lastName: u.last_name,
        enrollmentNumber: u.enrollment_number,
        email: u.email,
        isActive: u.is_active,
        batchId: u.batch_id,
        batchName: u.batch_name,
        institutionId: u.institution_id,
        institutionName: u.institution_name,
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/auth/register - institution request to join the platform
// Creates institution + admin account, but BOTH start deactivated.
// Super admin must activate before the college can use the platform.
router.post("/register", async (req, res) => {
  const {
    institutionName,
    institutionCode,
    adminFirstName,
    adminLastName,
    adminEmail,
    password,
  } = req.body;

  if (!institutionName || !institutionCode || !adminFirstName || !adminLastName || !adminEmail || !password) {
    return res.status(400).json({
      error: "institutionName, institutionCode, adminFirstName, adminLastName, adminEmail, password required",
    });
  }

  if (String(password).length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }
  if (String(password).length > MAX_PASSWORD_LENGTH) {
    return res.status(400).json({ error: "Password is too long (max 72 characters)" });
  }

  const email = String(adminEmail).toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "A valid admin email is required" });
  }

  try {
    const existingCode = await pool.query(
      `SELECT code FROM institutions WHERE LOWER(code) = LOWER($1) OR LOWER(name) = LOWER($2)`,
      [String(institutionCode).trim(), String(institutionName).trim()]
    );
    if (existingCode.rows.length > 0) {
      return res.status(409).json({
        error: "An institution with this name or code already exists. Contact the platform owner if this is yours.",
      });
    }

    const existingEmail = await pool.query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1)`,
      [String(adminEmail).toLowerCase().trim()]
    );
    if (existingEmail.rows.length > 0) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const hash = await bcrypt.hash(String(password), 10);
    const instResult = await pool.query(
      `INSERT INTO institutions (name, code) VALUES ($1, $2) RETURNING id`,
      [String(institutionName).trim(), String(institutionCode).trim().toUpperCase()]
    );
    const institutionId = instResult.rows[0].id;

    // Admin created but DEACTIVATED by default
    await pool.query(
      `INSERT INTO users
        (institution_id, role, first_name, last_name, email, password_hash, is_active)
       VALUES ($1, 'admin', $2, $3, $4, $5, FALSE)`,
      [
        institutionId,
        String(adminFirstName).trim(),
        String(adminLastName).trim(),
        String(adminEmail).toLowerCase().trim(),
        hash,
      ]
    );

    res.status(201).json({
      message:
        "Registration submitted. Your institution is pending approval — the platform owner will activate it. You'll be able to log in once activated.",
      status: "pending_approval",
      institutionId,
    });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;