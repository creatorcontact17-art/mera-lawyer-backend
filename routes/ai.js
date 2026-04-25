const express = require("express");
const rateLimit = require("express-rate-limit");
const { protectRoute } = require("../middleware/auth");
const aiController = require("../controllers/aiController");
const { logRateLimitHit } = require("../middleware/securityLogger");
const { botGuard } = require("../middleware/botGuard");

const router = express.Router();

// ── AI generation rate limiter ─────────────────────────────────────
// AI calls are expensive (Gemini/Groq API credits). Strict limit to
// prevent abuse while allowing normal study sessions.
const aiGenerateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max: 20,                     // 20 AI queries per 15 min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "You've reached the AI query limit. Please wait a few minutes before trying again.",
  },
  handler(req, res, next, options) {
    logRateLimitHit(req, { route: "POST /api/ai/generate" });
    res.status(options.statusCode).json(options.message);
  },
});

// ── Per-user daily quota (tracked per user ID from JWT) ────────────
// This prevents a single authenticated user from hogging the AI quota
// even if they rotate IPs.
const userDailyQuota = new Map();
const USER_DAILY_LIMIT = 50; // 50 AI queries per user per day
const QUOTA_RESET_MS = 24 * 60 * 60 * 1000; // 24 hours

// Clean stale user quotas every hour
setInterval(() => {
  const now = Date.now();
  userDailyQuota.forEach((entry, userId) => {
    if (now - entry.windowStart > QUOTA_RESET_MS) {
      userDailyQuota.delete(userId);
    }
  });
}, 60 * 60 * 1000);

function userQuotaMiddleware(req, res, next) {
  const userId = String(req.user?._id || "");
  if (!userId) return next(); // Should not happen (protectRoute runs first)

  const now = Date.now();
  let entry = userDailyQuota.get(userId);

  if (!entry || now - entry.windowStart > QUOTA_RESET_MS) {
    entry = { count: 0, windowStart: now };
    userDailyQuota.set(userId, entry);
  }

  entry.count += 1;

  if (entry.count > USER_DAILY_LIMIT) {
    const resetIn = Math.ceil((entry.windowStart + QUOTA_RESET_MS - now) / 60000);
    return res.status(429).json({
      success: false,
      message: `Daily AI query limit reached (${USER_DAILY_LIMIT}/day). Resets in ~${resetIn} minutes.`,
    });
  }

  // Expose remaining quota in response header
  res.set("X-AI-Quota-Remaining", String(USER_DAILY_LIMIT - entry.count));
  next();
}

router.post(
  "/generate",
  botGuard({ speedCheck: true }),  // Block bots and rapid-fire scripts
  aiGenerateLimiter,                // IP-based rate limit
  protectRoute,                     // Must be authenticated
  userQuotaMiddleware,              // Per-user daily quota
  aiController.generate
);

module.exports = router;
