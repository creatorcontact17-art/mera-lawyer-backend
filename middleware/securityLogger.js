/**
 * securityLogger — structured security event logging utility.
 *
 * Logs authentication events, API errors, and suspicious traffic
 * patterns to stdout in a structured JSON format that is easy to
 * parse by log aggregation services (Datadog, CloudWatch, etc.).
 *
 * In production, these logs should be shipped to a SIEM or log
 * management platform for alerting on anomalies.
 */

const { env } = require("../config/env");

// ── Log Levels ─────────────────────────────────────────────────────
const LEVEL = Object.freeze({
  INFO: "INFO",
  WARN: "WARN",
  ERROR: "ERROR",
  SECURITY: "SECURITY",
});

// ── Helpers ────────────────────────────────────────────────────────

function getClientIp(req) {
  // Behind reverse proxies (Render, Netlify, Cloudflare), the real
  // client IP is in x-forwarded-for. Take the first (leftmost) value.
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return String(forwarded).split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function buildLogEntry(level, event, details) {
  return {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...details,
  };
}

function emit(entry) {
  // Structured JSON to stdout — cloud platforms capture this natively
  const line = JSON.stringify(entry);

  if (entry.level === LEVEL.ERROR || entry.level === LEVEL.SECURITY) {
    console.error(line);
  } else if (entry.level === LEVEL.WARN) {
    console.warn(line);
  } else {
    console.log(line);
  }
}

// ── Auth Events ────────────────────────────────────────────────────

function logSignup(req, { email, success }) {
  emit(
    buildLogEntry(LEVEL.INFO, "AUTH_SIGNUP", {
      ip: getClientIp(req),
      email,
      success,
      userAgent: req.headers["user-agent"] || "",
    })
  );
}

function logLogin(req, { email, success, reason }) {
  const level = success ? LEVEL.INFO : LEVEL.WARN;
  emit(
    buildLogEntry(level, "AUTH_LOGIN", {
      ip: getClientIp(req),
      email,
      success,
      reason: reason || "",
      userAgent: req.headers["user-agent"] || "",
    })
  );
}

function logGoogleLogin(req, { email, success, isNewUser }) {
  emit(
    buildLogEntry(LEVEL.INFO, "AUTH_GOOGLE_LOGIN", {
      ip: getClientIp(req),
      email,
      success,
      isNewUser: Boolean(isNewUser),
      userAgent: req.headers["user-agent"] || "",
    })
  );
}

function logAccountLockout(req, { email }) {
  emit(
    buildLogEntry(LEVEL.SECURITY, "AUTH_ACCOUNT_LOCKOUT", {
      ip: getClientIp(req),
      email,
      message: "Account locked due to repeated failed login attempts.",
      userAgent: req.headers["user-agent"] || "",
    })
  );
}

function logPasswordReset(req, { email, stage }) {
  emit(
    buildLogEntry(LEVEL.INFO, "AUTH_PASSWORD_RESET", {
      ip: getClientIp(req),
      email: email || "unknown",
      stage, // "requested" | "completed"
      userAgent: req.headers["user-agent"] || "",
    })
  );
}

function logEmailVerification(req, { email, success }) {
  emit(
    buildLogEntry(LEVEL.INFO, "AUTH_EMAIL_VERIFICATION", {
      ip: getClientIp(req),
      email: email || "unknown",
      success,
      userAgent: req.headers["user-agent"] || "",
    })
  );
}

function logTokenRejected(req, { reason }) {
  emit(
    buildLogEntry(LEVEL.WARN, "AUTH_TOKEN_REJECTED", {
      ip: getClientIp(req),
      reason,
      path: req.originalUrl,
      userAgent: req.headers["user-agent"] || "",
    })
  );
}

// ── Rate Limit Events ──────────────────────────────────────────────

function logRateLimitHit(req, { route }) {
  emit(
    buildLogEntry(LEVEL.SECURITY, "RATE_LIMIT_HIT", {
      ip: getClientIp(req),
      route: route || req.originalUrl,
      method: req.method,
      userAgent: req.headers["user-agent"] || "",
    })
  );
}

// ── API Errors ─────────────────────────────────────────────────────

function logApiError(req, { statusCode, message, error }) {
  emit(
    buildLogEntry(LEVEL.ERROR, "API_ERROR", {
      ip: getClientIp(req),
      method: req.method,
      path: req.originalUrl,
      statusCode,
      message,
      stack:
        env.nodeEnv !== "production" && error?.stack
          ? error.stack.split("\n").slice(0, 3).join(" | ")
          : undefined,
      userAgent: req.headers["user-agent"] || "",
    })
  );
}

// ── Suspicious Activity ────────────────────────────────────────────

function logSuspiciousActivity(req, { reason, details }) {
  emit(
    buildLogEntry(LEVEL.SECURITY, "SUSPICIOUS_ACTIVITY", {
      ip: getClientIp(req),
      method: req.method,
      path: req.originalUrl,
      reason,
      details: details || "",
      userAgent: req.headers["user-agent"] || "",
    })
  );
}

// ── Request logging middleware ──────────────────────────────────────

/**
 * Middleware that logs every incoming request with timing.
 * Attach early in the middleware chain.
 */
function requestLogger(req, res, next) {
  const start = Date.now();

  // Log when the response finishes
  res.on("finish", () => {
    const duration = Date.now() - start;
    const level =
      res.statusCode >= 500
        ? LEVEL.ERROR
        : res.statusCode >= 400
          ? LEVEL.WARN
          : LEVEL.INFO;

    emit(
      buildLogEntry(level, "HTTP_REQUEST", {
        ip: getClientIp(req),
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: duration,
        contentLength: res.getHeader("content-length") || 0,
      })
    );
  });

  next();
}

module.exports = {
  LEVEL,
  getClientIp,
  logAccountLockout,
  logApiError,
  logEmailVerification,
  logGoogleLogin,
  logLogin,
  logPasswordReset,
  logRateLimitHit,
  logSignup,
  logSuspiciousActivity,
  logTokenRejected,
  requestLogger,
};
