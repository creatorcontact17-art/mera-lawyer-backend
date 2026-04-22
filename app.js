const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const authRoutes = require("./routes/auth");
const aiRoutes = require("./routes/ai");
const { env } = require("./config/env");
const { getDatabaseStatus } = require("./config/db");
const { requireDatabase } = require("./middleware/requireDatabase");
const { sanitizeBody } = require("./middleware/sanitize");

const app = express();

app.disable("x-powered-by");
app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || env.clientOrigins.includes("*")) {
        callback(null, true);
        return;
      }

      callback(null, env.clientOrigins.includes(origin));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: false }));
app.use(sanitizeBody);

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests from this IP. Please try again later.",
  },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many authentication attempts. Please try again later.",
  },
});

app.use(globalLimiter);

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    name: "Mera Lawyer Backend",
    message: "Backend is running. See /api and /health.",
  });
});

app.get("/api", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Available backend endpoints.",
    endpoints: [
      { method: "GET", path: "/" },
      { method: "GET", path: "/api" },
      { method: "GET", path: "/health" },
      { method: "POST", path: "/api/auth/signup" },
      { method: "POST", path: "/api/auth/login" },
      { method: "POST", path: "/api/auth/forgot-password" },
      { method: "POST", path: "/api/auth/reset-password" },
      { method: "GET", path: "/api/auth/me" },
      { method: "PUT", path: "/api/auth/profile" },
      { method: "POST", path: "/api/ai/generate" },
    ],
  });
});

app.use("/api/auth", authLimiter, requireDatabase, authRoutes);
app.use("/api/ai", requireDatabase, aiRoutes);

app.get("/health", (req, res) => {
  const database = getDatabaseStatus();
  const isHealthy = database.isConnected;

  res.status(isHealthy ? 200 : 503).json({
    success: isHealthy,
    message: isHealthy
      ? "API and database are ready."
      : "API is running, but the database is unavailable.",
    environment: env.nodeEnv,
    database,
    ai: {
      provider: env.aiProvider,
      model: env.aiModel,
    },
    timestamp: new Date().toISOString(),
  });
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found.`,
  });
});

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({
      success: false,
      message: "Invalid JSON payload.",
    });
  }

  console.error("Unhandled error:", err);
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || "Internal server error.",
  });
});

module.exports = app;
