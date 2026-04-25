const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const authRoutes = require("./routes/auth");
const aiRoutes = require("./routes/ai");
const contentRoutes = require("./routes/content");
const { env } = require("./config/env");
const { getDatabaseStatus } = require("./config/db");
const { requireDatabase } = require("./middleware/requireDatabase");
const { sanitizeBody } = require("./middleware/sanitize");
const { enforceHttps } = require("./middleware/enforceHttps");
const {
  requestLogger,
  logApiError,
  logRateLimitHit,
  logSuspiciousActivity,
} = require("./middleware/securityLogger");
const { botGuard } = require("./middleware/botGuard");

const app = express();

// ── Trust proxy (required for x-forwarded-* headers on Render/Heroku) ──
// This ensures req.ip, x-forwarded-proto, and rate limiter IP detection
// all work correctly behind a reverse proxy.
app.set("trust proxy", 1);

app.disable("x-powered-by");

// ── HTTPS enforcement (production only) ────────────────────────────
app.use(enforceHttps);

// ── Security headers ───────────────────────────────────────────────
app.use(
  helmet({
    // HSTS: tell browsers to always use HTTPS for 1 year,
    // including subdomains. Only active over HTTPS connections.
    hsts: {
      maxAge: 31536000, // 1 year in seconds
      includeSubDomains: true,
      preload: true,
    },
    // Prevent framing (clickjacking protection)
    frameguard: { action: "deny" },
    // Prevent MIME type sniffing
    noSniff: true,
    // Referrer-Policy: only send origin on cross-origin requests
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    // Content-Security-Policy: restrict resource loading
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  })
);

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

// ── Structured request logging ─────────────────────────────────────
app.use(requestLogger);

// ── Rate limiters ──────────────────────────────────────────────────

function createRateLimiter({ windowMs, max, message, route }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message },
    handler(req, res, next, options) {
      // Log the rate limit hit for security monitoring
      logRateLimitHit(req, { route: route || req.originalUrl });
      res.status(options.statusCode).json(options.message);
    },
  });
}

const globalLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests from this IP. Please try again later.",
  route: "global",
});

const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "Too many authentication attempts. Please try again later.",
  route: "/api/auth",
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
      { method: "GET", path: "/api/content/mcq/bundle" },
      { method: "GET", path: "/api/content/test-series/config" },
      { method: "POST", path: "/api/content/test-series/attempt" },
      { method: "GET", path: "/api/content/test-series/attempt/:attemptId" },
      { method: "POST", path: "/api/content/test-series/attempt/:attemptId/submit" },
      { method: "GET", path: "/api/content/books/manifest" },
      { method: "GET", path: "/api/content/books/file?path=..." },
      { method: "GET", path: "/api/content/books/cover?path=..." },
      { method: "GET", path: "/api/content/articles/manifest" },
      { method: "GET", path: "/api/content/articles/article?item=..." },
      { method: "POST", path: "/api/auth/signup" },
      { method: "POST", path: "/api/auth/login" },
      { method: "POST", path: "/api/auth/google" },
      { method: "POST", path: "/api/auth/forgot-password" },
      { method: "POST", path: "/api/auth/reset-password" },
      { method: "POST", path: "/api/auth/verify-email" },
      { method: "POST", path: "/api/auth/resend-verification" },
      { method: "GET", path: "/api/auth/me" },
      { method: "PUT", path: "/api/auth/profile" },
      { method: "POST", path: "/api/ai/generate" },
    ],
  });
});

// Bot guard on all API routes — blocks scrapers and automated scripts
const apiBotGuard = botGuard({ blockMissingUA: true, blockKnownBots: true, speedCheck: false });

// Auth config endpoint (no database needed — serves Google Client ID from env).
// Registered BEFORE the requireDatabase gate so it works during cold starts.
const { getAuthConfig } = require("./controllers/authController");
app.get("/api/auth/config", apiBotGuard, getAuthConfig);

app.use("/api/auth", apiBotGuard, authLimiter, requireDatabase, authRoutes);
app.use("/api/ai", requireDatabase, aiRoutes); // AI routes have their own botGuard
app.use("/api/content", contentRoutes); // Content routes have their own botGuard

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

// ── 404 handler with suspicious activity logging ───────────────────
app.use((req, res) => {
  // Log probing attempts for non-existent routes (common attack pattern)
  const suspiciousPatterns = [
    /\.\.\//,          // path traversal
    /\/\.(env|git|aws|ssh|config)/i, // sensitive file probing
    /\/(wp-admin|phpmyadmin|admin|xmlrpc)/i, // CMS probing
    /\.(php|asp|jsp|cgi)$/i, // wrong-tech probing
  ];

  const path = req.originalUrl;
  const isSuspicious = suspiciousPatterns.some((pattern) => pattern.test(path));

  if (isSuspicious) {
    logSuspiciousActivity(req, {
      reason: "Probe attempt on non-existent route",
      details: `${req.method} ${path}`,
    });
  }

  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found.`,
  });
});

// ── Global error handler with logging ──────────────────────────────
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && "body" in err) {
    logApiError(req, {
      statusCode: 400,
      message: "Invalid JSON payload",
      error: err,
    });
    return res.status(400).json({
      success: false,
      message: "Invalid JSON payload.",
    });
  }

  const statusCode = err.statusCode || 500;
  logApiError(req, {
    statusCode,
    message: err.message || "Internal server error",
    error: err,
  });

  res.status(statusCode).json({
    success: false,
    // In production, never leak internal error messages to the client
    message:
      env.nodeEnv === "production" && statusCode === 500
        ? "Internal server error."
        : err.message || "Internal server error.",
  });
});

module.exports = app;
