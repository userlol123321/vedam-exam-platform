const jwt = require("jsonwebtoken");
const { pool } = require("../config/database");

const JWT_SECRET = process.env.JWT_SECRET;

// Never fall back to a known secret in production — a leaked default lets
// anyone forge admin tokens.
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET must be set in production");
  }
  console.warn(
    "⚠ WARNING: JWT_SECRET not set. Using an insecure development default."
  );
}
const secret = JWT_SECRET || "dev-secret-change-me";

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      institutionId: user.institution_id,
      batchId: user.batch_id || null,
      batchYear: user.batch_year || null,
      isActive: user.is_active !== false,
    },
    secret,
    { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
  );
}

// Re-check account status on every request so deactivated or deleted
// accounts lose access immediately (JWTs are otherwise valid until expiry).
async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  try {
    const token = header.split(" ")[1];
    const claims = jwt.verify(token, secret);

    const result = await pool.query(
      `SELECT is_active, role FROM users WHERE id = $1`,
      [claims.id]
    );
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: "Account no longer exists" });
    if (!user.is_active) {
      return res.status(403).json({
        error:
          "Your account is deactivated. Contact your institution admin or the platform service owner for activation.",
        deactivated: true,
      });
    }

    req.user = { ...claims, role: user.role };
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Session expired. Please log in again." });
    }
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || (req.user.role !== "admin" && req.user.role !== "super_admin")) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== "super_admin") {
    return res.status(403).json({ error: "Platform owner access required" });
  }
  next();
}

function requireStudent(req, res, next) {
  if (!req.user || req.user.role !== "student") {
    return res.status(403).json({ error: "Student access required" });
  }
  next();
}

module.exports = { signToken, requireAuth, requireAdmin, requireSuperAdmin, requireStudent };