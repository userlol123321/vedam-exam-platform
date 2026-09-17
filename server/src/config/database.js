require("dotenv").config();
const { Pool } = require("pg");

const isSetupMode = process.argv.includes("--setup");
const isSeedMode = process.argv.includes("--seed");

const isNeon = String(process.env.DATABASE_URL || "").includes("neon.tech");

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@localhost:5432/vedam_exam",
  ssl:
    isNeon || process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS institutions (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  code VARCHAR(50) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS batches (
  id SERIAL PRIMARY KEY,
  institution_id INTEGER REFERENCES institutions(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  UNIQUE(institution_id, name)
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  institution_id INTEGER REFERENCES institutions(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL DEFAULT 'student',
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  enrollment_number VARCHAR(50) UNIQUE,
  email VARCHAR(200) UNIQUE,
  password_hash VARCHAR(200) NOT NULL,
  batch_id INTEGER REFERENCES batches(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tests (
  id SERIAL PRIMARY KEY,
  institution_id INTEGER REFERENCES institutions(id) ON DELETE CASCADE,
  batch_id INTEGER REFERENCES batches(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  available_from TIMESTAMPTZ NOT NULL,
  available_until TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  allow_late_start BOOLEAN DEFAULT TRUE,
  results_visibility VARCHAR(10) DEFAULT 'hidden',
  allow_rank_view BOOLEAN DEFAULT FALSE,
  encryption_key TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS questions (
  id SERIAL PRIMARY KEY,
  test_id INTEGER REFERENCES tests(id) ON DELETE CASCADE,
  type VARCHAR(10) NOT NULL,
  question_text TEXT NOT NULL,
  options JSON,
  correct_answer TEXT,
  marks INTEGER NOT NULL DEFAULT 1,
  negative_marks NUMERIC(5,2) DEFAULT 0,
  language VARCHAR(20),
  starter_code TEXT,
  complexity_requirement TEXT,
  input_constraints TEXT,
  banned_patterns JSON,
  restrict_msg TEXT,
  time_limit_ms INTEGER DEFAULT 2000,
  memory_limit_mb INTEGER DEFAULT 256,
  sample_test_cases JSON,
  hidden_test_cases JSON,
  marking_mode VARCHAR(20) DEFAULT 'partial',
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS test_case_weights (
  id SERIAL PRIMARY KEY,
  question_id INTEGER REFERENCES questions(id) ON DELETE CASCADE,
  case_index INTEGER NOT NULL,
  weight NUMERIC(5,2) NOT NULL DEFAULT 1,
  UNIQUE(question_id, case_index)
);

CREATE TABLE IF NOT EXISTS submissions (
  id SERIAL PRIMARY KEY,
  test_id INTEGER REFERENCES tests(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  answers JSON,
  started_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  tab_switches INTEGER DEFAULT 0,
  score NUMERIC(8,2) DEFAULT 0,
  total_marks NUMERIC(8,2) DEFAULT 0,
  is_graded BOOLEAN DEFAULT FALSE,
  UNIQUE(test_id, student_id)
);

CREATE TABLE IF NOT EXISTS grading_details (
  id SERIAL PRIMARY KEY,
  submission_id INTEGER REFERENCES submissions(id) ON DELETE CASCADE,
  question_id INTEGER REFERENCES questions(id) ON DELETE CASCADE,
  earned_marks NUMERIC(8,2) DEFAULT 0,
  is_correct BOOLEAN,
  case_results JSON,
  restriction_violation TEXT,
  details TEXT,
  UNIQUE(submission_id, question_id)
);

CREATE TABLE IF NOT EXISTS results_published (
  id SERIAL PRIMARY KEY,
  test_id INTEGER REFERENCES tests(id) ON DELETE CASCADE,
  published_by INTEGER REFERENCES users(id),
  published_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(test_id)
);
`;

async function setupDatabase() {
  try {
    console.log("Setting up database schema...");
    await pool.query(SCHEMA);
    console.log("✓ Database schema created successfully");
  } catch (err) {
    console.error("✗ Database setup failed:", err.message);
  } finally {
    await pool.end();
  }
}

async function seedDatabase() {
  try {
    const bcrypt = require("bcryptjs");
    console.log("Seeding default data...");

    // Super Admin (platform/service owner)
    const superPasswordHash = await bcrypt.hash(
      process.env.SUPER_ADMIN_PASSWORD || "superadmin123",
      10
    );
    const superInstResult = await pool.query(
      `INSERT INTO institutions (name, code)
       VALUES ('Vedam Platform', 'PLATFORM')
       ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code
       RETURNING id`
    );
    const superInstId = superInstResult.rows[0].id;
    await pool.query(
      `INSERT INTO users (institution_id, role, first_name, last_name, email, password_hash, is_active)
       VALUES ($1, 'super_admin', 'Platform', 'Owner', $2, $3, TRUE)
       ON CONFLICT (email) DO UPDATE SET is_active = TRUE`,
      [superInstId, process.env.SUPER_ADMIN_EMAIL || "platform@vedam.app", superPasswordHash]
    );

    // Seed a default institution + admin (activated by default so demo works)
    const passwordHash = await bcrypt.hash("admin123", 10);
    const instResult = await pool.query(
      `INSERT INTO institutions (name, code)
       VALUES ('Vedam School of Technology', 'VEDAM01')
       ON CONFLICT (code) DO NOTHING
       RETURNING id`
    );
    const institutionId = instResult.rows[0]?.id;

    if (institutionId) {
      await pool.query(
        `INSERT INTO users (institution_id, role, first_name, last_name, email, password_hash)
         VALUES ($1, 'admin', 'System', 'Admin', 'admin@vedam.edu', $2)`,
        [institutionId, passwordHash]
      );
      await pool.query(
        `INSERT INTO batches (institution_id, name) VALUES ($1, '1st Year A')`,
        [institutionId]
      );
    }

    console.log("✓ Default data seeded:");
    console.log("  Super Admin: platform@vedam.app / superadmin123");
    console.log("  Institution: Vedam School of Technology (code: VEDAM01)");
    console.log("  Admin:       admin@vedam.edu / admin123");
    console.log("  Batch:       1st Year A");
  } catch (err) {
    console.error("✗ Seed failed:", err.message);
  } finally {
    await pool.end();
  }
}

if (isSetupMode) setupDatabase();
else if (isSeedMode) seedDatabase();

module.exports = { pool };