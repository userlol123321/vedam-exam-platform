require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const { pool } = require("./config/database");
const authRoutes = require("./routes/auth");
const studentAdminRoutes = require("./routes/students");
const testRoutes = require("./routes/tests");
const submissionRoutes = require("./routes/submissions");
const resultRoutes = require("./routes/results");
const superAdminRoutes = require("./routes/superadmin");

const app = express();

// Behind Render/nginx, X-Forwarded-For arrives so rate-limiters see real IPs.
app.set("trust proxy", process.env.TRUST_PROXY === "1");

app.use(helmet());

const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim())
  : ["http://localhost:5173"];
app.use(
  cors({
    origin(origin, cb) {
      // Allow requests with no Origin, and the null origin (Electron app
      // packaged as file://). Both server-to-server and the desktop app.
      if (!origin || origin === "null") return cb(null, true);
      if (corsOrigins.includes(origin)) return cb(null, true);
      return cb(new Error("Origin not allowed by CORS"));
    },
  })
);
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

// Global API rate limit
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", limiter);

app.get("/health", (req, res) => res.json({ status: "ok", time: new Date() }));

app.use("/api/auth", authRoutes);
app.use("/api/admin", studentAdminRoutes); // batches + students
app.use("/api/admin/tests", testRoutes); // test CRUD + questions
app.use("/api/admin/results", resultRoutes); // results analytics + publish
app.use("/api/student", submissionRoutes); // student tests + submit + code run
app.use("/api/super", superAdminRoutes); // platform owner dashboard

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Error handler
app.use((err, req, res, next) => {
  if (err.message === "Origin not allowed by CORS") {
    return res.status(403).json({ error: err.message });
  }
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body too large" });
  }
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Exam Platform API Server running on port ${PORT}`);
  console.log(`  Mode: ${process.env.NODE_ENV || "development"}`);
  console.log(`  Judge0 mode: ${process.env.JUDGE0_MODE || "CLOUD"}`);
});