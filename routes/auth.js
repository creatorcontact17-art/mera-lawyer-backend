const express = require("express");
const rateLimit = require("express-rate-limit");
const { protectRoute } = require("../middleware/auth");
const authController = require("../controllers/authController");
const { logRateLimitHit } = require("../middleware/securityLogger");

const router = express.Router();

// ── Rate limiter factory with security logging ─────────────────────

function authRateLimiter({ windowMs, max, message, route }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message },
    handler(req, res, next, options) {
      logRateLimitHit(req, { route });
      res.status(options.statusCode).json(options.message);
    },
  });
}

// ── Per-route rate limiters (stricter than the global authLimiter) ──

const loginLimiter = authRateLimiter({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max: 5,                      // 5 login attempts per window
  message: "Too many login attempts. Please try again in 15 minutes.",
  route: "POST /api/auth/login",
});

const signupLimiter = authRateLimiter({
  windowMs: 60 * 60 * 1000,   // 1 hour
  max: 3,                      // 3 signups per hour per IP
  message: "Too many accounts created from this IP. Please try again later.",
  route: "POST /api/auth/signup",
});

const forgotPasswordLimiter = authRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: "Too many password reset requests. Please try again later.",
  route: "POST /api/auth/forgot-password",
});

const resetPasswordLimiter = authRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: "Too many password reset attempts. Please try again later.",
  route: "POST /api/auth/reset-password",
});

const resendVerificationLimiter = authRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: "Too many verification requests. Please try again later.",
  route: "POST /api/auth/resend-verification",
});

const verifyEmailLimiter = authRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Too many verification attempts. Please try again later.",
  route: "POST /api/auth/verify-email",
});

const configLimiter = authRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,                     // Config is fetched on every page load
  message: "Too many requests. Please try again later.",
  route: "GET /api/auth/config",
});

// ── Public routes ──────────────────────────────────────────────────
router.get("/config", configLimiter, authController.getAuthConfig);
router.post("/signup", signupLimiter, authController.signup);
router.post("/login", loginLimiter, authController.login);
router.post("/google", loginLimiter, authController.googleLogin);
router.post("/forgot-password", forgotPasswordLimiter, authController.forgotPassword);
router.post("/reset-password", resetPasswordLimiter, authController.resetPassword);
router.post("/verify-email", verifyEmailLimiter, authController.verifyEmail);
router.post("/resend-verification", resendVerificationLimiter, authController.resendVerification);

// ── Protected routes ───────────────────────────────────────────────
router.get("/me", protectRoute, authController.getMe);
router.put("/profile", protectRoute, authController.updateProfile);

module.exports = router;
