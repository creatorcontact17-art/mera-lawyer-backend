const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");

const User = require("../models/User");
const { env } = require("../config/env");
const secLog = require("../middleware/securityLogger");
const {
  isValidEmail,
  isValidPassword,
  isValidName,
  isValidHexToken,
  isValidGoogleCredential,
  isValidProfileField,
  PASSWORD_MAX_LENGTH,
  NAME_MAX_LENGTH,
} = require("../middleware/inputValidator");

// ── Constants ──────────────────────────────────────────────────────
const SALT_ROUNDS = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const EMAIL_VERIFY_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

const googleClient = new OAuth2Client(env.googleClientId);

/**
 * Password complexity rule (backend is the source of truth):
 *   ≥ 8 chars, at least 1 uppercase, 1 lowercase, 1 digit.
 */
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

// Pre-hashed dummy password used for timing-safe comparison when user is
// not found — prevents login timing attacks that reveal email existence.
let DUMMY_HASH = null;
(async () => {
  DUMMY_HASH = await bcrypt.hash("__dummy_timing_safe__", SALT_ROUNDS);
})();

// ── Helpers ────────────────────────────────────────────────────────

function generateToken(userId) {
  return jwt.sign({ id: userId }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
}

function sanitizeUser(user) {
  return {
    id: user._id,
    name: user.name,
    fullName: user.name,
    email: user.email,
    course: user.course || "",
    semester: user.semester || "",
    isEmailVerified: user.isEmailVerified || false,
    status: "Active",
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.updatedAt,
  };
}

function generateVerificationToken() {
  const raw = crypto.randomBytes(32).toString("hex");
  const hashed = crypto.createHash("sha256").update(raw).digest("hex");
  return { raw, hashed };
}

/**
 * Returns true if email verification should be skipped.
 * In development mode, the SKIP_EMAIL_VERIFICATION env var can be set
 * to "true" to allow testing without an email provider.
 */
function shouldSkipEmailVerification() {
  return (
    env.nodeEnv !== "production" &&
    (process.env.SKIP_EMAIL_VERIFICATION || "").trim().toLowerCase() === "true"
  );
}

// ── SIGNUP ─────────────────────────────────────────────────────────

async function signup(req, res) {
  try {
    const name = String(req.body.name || req.body.fullName || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide name, email, and password.",
      });
    }

    if (!isValidName(name)) {
      return res.status(400).json({
        success: false,
        message: `Name must be 2–${NAME_MAX_LENGTH} characters and contain only letters, spaces, hyphens, or apostrophes.`,
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address.",
      });
    }

    if (password.length > PASSWORD_MAX_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Password cannot exceed ${PASSWORD_MAX_LENGTH} characters.`,
      });
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({
        success: false,
        message:
          "Password must be at least 8 characters and include an uppercase letter, a lowercase letter, and a digit.",
      });
    }

    const existingUser = await User.findOne({ email }).lean();
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    // Generate email verification token
    const { raw: verifyRaw, hashed: verifyHashed } =
      generateVerificationToken();

    const skipVerification = shouldSkipEmailVerification();

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      isEmailVerified: skipVerification, // Auto-verify in dev if configured
      emailVerificationToken: skipVerification ? undefined : verifyHashed,
      emailVerificationExpires: skipVerification
        ? undefined
        : new Date(Date.now() + EMAIL_VERIFY_EXPIRY_MS),
    });

    // In development, log the verification token (no email provider configured)
    if (env.nodeEnv !== "production" && !skipVerification) {
      console.log(
        `[DEV] Email verification token for ${email}: ${verifyRaw}`
      );
    }

    // SECURITY: Do NOT issue a JWT on signup.
    // The user must verify their email first, then log in.
    // Exception: if email verification is skipped in dev mode, issue a JWT.
    secLog.logSignup(req, { email, success: true });

    if (skipVerification) {
      const token = generateToken(user._id);
      return res.status(201).json({
        success: true,
        message: "Account created successfully (email verification skipped in dev mode).",
        token,
        user: sanitizeUser(user),
      });
    }

    return res.status(201).json({
      success: true,
      message:
        "Account created successfully. Please check your email to verify your account before logging in.",
      user: sanitizeUser(user),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    secLog.logSignup(req, { email: req.body?.email || "unknown", success: false });
    console.error("Signup error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again later.",
    });
  }
}

// ── LOGIN ──────────────────────────────────────────────────────────

async function login(req, res) {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide email and password.",
      });
    }

    if (!isValidEmail(email) || password.length > PASSWORD_MAX_LENGTH) {
      return res.status(400).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const user = await User.findOne({ email }).select(
      "+password +failedLoginAttempts +lockUntil"
    );

    // ── Timing-safe: always perform a bcrypt compare ─────────────
    if (!user) {
      // Dummy compare to equalise response time
      await bcrypt.compare(password, DUMMY_HASH);
      secLog.logLogin(req, { email, success: false, reason: "unknown_email" });
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    // ── Account lockout check ────────────────────────────────────
    if (user.lockUntil && user.lockUntil > Date.now()) {
      const remainingMs = user.lockUntil - Date.now();
      const remainingMin = Math.ceil(remainingMs / 60000);
      secLog.logLogin(req, { email, success: false, reason: "account_locked" });
      return res.status(423).json({
        success: false,
        message: `Account temporarily locked. Try again in ${remainingMin} minute${remainingMin === 1 ? "" : "s"}.`,
      });
    }

    // ── Google-only account guard ────────────────────────────────
    if (!user.password) {
      return res.status(401).json({
        success: false,
        message:
          "This account uses Google sign-in. Please use the Google button.",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      // Increment failed attempts
      const attempts = (user.failedLoginAttempts || 0) + 1;
      const update = { failedLoginAttempts: attempts };

      if (attempts >= MAX_FAILED_ATTEMPTS) {
        update.lockUntil = new Date(Date.now() + LOCK_DURATION_MS);
        update.failedLoginAttempts = 0; // Reset counter after locking
        secLog.logAccountLockout(req, { email });
      }

      await User.updateOne({ _id: user._id }, update);

      secLog.logLogin(req, { email, success: false, reason: "wrong_password" });
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    // ── Email verification enforcement ───────────────────────────
    // Google OAuth users are always verified. For password-based accounts,
    // the user must verify their email before gaining access.
    if (!user.isEmailVerified && !shouldSkipEmailVerification()) {
      return res.status(403).json({
        success: false,
        message:
          "Please verify your email address before logging in. Check your inbox for the verification link.",
      });
    }

    // ── Successful login — reset lockout counters ────────────────
    if (user.failedLoginAttempts > 0 || user.lockUntil) {
      await User.updateOne(
        { _id: user._id },
        { failedLoginAttempts: 0, $unset: { lockUntil: 1 } }
      );
    }

    secLog.logLogin(req, { email, success: true, reason: "credentials" });
    const token = generateToken(user._id);

    return res.status(200).json({
      success: true,
      message: "Login successful.",
      token,
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again later.",
    });
  }
}

// ── GOOGLE LOGIN ───────────────────────────────────────────────────

async function googleLogin(req, res) {
  try {
    const credential = String(req.body.credential || "").trim();

    if (!credential || !isValidGoogleCredential(credential)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Google credential.",
      });
    }

    if (!env.googleClientId) {
      return res.status(500).json({
        success: false,
        message: "Google sign-in is not configured on this server.",
      });
    }

    // Verify the Google ID token
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: env.googleClientId,
    });

    const payload = ticket.getPayload();
    const googleId = payload.sub;
    const email = (payload.email || "").toLowerCase();
    const name = payload.name || email.split("@")[0];

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Could not retrieve email from Google account.",
      });
    }

    // Try to find user by googleId first, then by email
    let user = await User.findOne({
      $or: [{ googleId }, { email }],
    }).select("+googleId");

    if (user) {
      // Link Google ID if not already linked
      if (!user.googleId) {
        user.googleId = googleId;
        user.isEmailVerified = true; // Google-verified email
        await user.save();
      }
    } else {
      // Create new user (no password needed for Google users)
      user = await User.create({
        name,
        email,
        googleId,
        isEmailVerified: true, // Google has already verified the email
      });
    }

    secLog.logGoogleLogin(req, { email, success: true, isNewUser: !user.googleId });
    const token = generateToken(user._id);

    return res.status(200).json({
      success: true,
      message: "Google sign-in successful.",
      token,
      user: sanitizeUser(user),
    });
  } catch (error) {
    secLog.logGoogleLogin(req, { email: "unknown", success: false });
    console.error("Google login error:", error);

    if (error.message && error.message.includes("Token used too late")) {
      return res.status(401).json({
        success: false,
        message: "Google token has expired. Please try again.",
      });
    }

    return res.status(401).json({
      success: false,
      message: "Google authentication failed. Please try again.",
    });
  }
}

// ── FORGOT PASSWORD ────────────────────────────────────────────────

async function forgotPassword(req, res) {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address.",
      });
    }

    const user = await User.findOne({ email });
    if (!user) {
      // Don't reveal whether the email exists
      return res.status(200).json({
        success: true,
        message:
          "If an account with that email exists, a reset link has been sent.",
      });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    user.resetPasswordToken = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");
    user.resetPasswordExpires = Date.now() + 15 * 60 * 1000;

    await user.save();
    secLog.logPasswordReset(req, { email, stage: "requested" });

    // In development, log the token to console (no email provider yet)
    if (env.nodeEnv !== "production") {
      console.log(`[DEV] Password reset token for ${email}: ${resetToken}`);
    }

    // SECURITY: Never return the raw token in the HTTP response.
    // In production, this would be sent via email.
    return res.status(200).json({
      success: true,
      message:
        "If an account with that email exists, a reset link has been sent.",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again later.",
    });
  }
}

// ── RESET PASSWORD ─────────────────────────────────────────────────

async function resetPassword(req, res) {
  try {
    const token = String(req.body.token || "").trim();
    const newPassword = String(
      req.body.newPassword || req.body.password || ""
    );

    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Token and new password are required.",
      });
    }

    if (!isValidHexToken(token)) {
      return res.status(400).json({
        success: false,
        message: "Invalid reset token format.",
      });
    }

    if (newPassword.length > PASSWORD_MAX_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Password cannot exceed ${PASSWORD_MAX_LENGTH} characters.`,
      });
    }

    if (!isValidPassword(newPassword)) {
      return res.status(400).json({
        success: false,
        message:
          "Password must be at least 8 characters and include an uppercase letter, a lowercase letter, and a digit.",
      });
    }

    const hashedToken = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() },
    }).select("+resetPasswordToken +resetPasswordExpires");

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Reset token is invalid or has expired.",
      });
    }

    user.password = await bcrypt.hash(newPassword, SALT_ROUNDS);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;

    // Clear any lockout state so the user can log in after reset
    user.failedLoginAttempts = 0;
    user.lockUntil = undefined;

    // SECURITY: Record the password change timestamp so that all
    // JWTs issued before this moment are automatically invalidated
    // by the protectRoute middleware.
    user.passwordChangedAt = new Date();

    await user.save();
    secLog.logPasswordReset(req, { email: user.email, stage: "completed" });

    // SECURITY: Do NOT auto-issue a JWT on password reset.
    // Force the user to log in manually to reduce risk if the
    // reset token was intercepted.
    return res.status(200).json({
      success: true,
      message: "Password reset successful. Please log in with your new password.",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again later.",
    });
  }
}

// ── VERIFY EMAIL ───────────────────────────────────────────────────

async function verifyEmail(req, res) {
  try {
    const token = String(req.body.token || "").trim();

    if (!token || !isValidHexToken(token)) {
      return res.status(400).json({
        success: false,
        message: "Invalid verification token format.",
      });
    }

    const hashedToken = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const user = await User.findOne({
      emailVerificationToken: hashedToken,
      emailVerificationExpires: { $gt: Date.now() },
    }).select("+emailVerificationToken +emailVerificationExpires");

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Verification token is invalid or has expired.",
      });
    }

    user.isEmailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();
    secLog.logEmailVerification(req, { email: user.email, success: true });

    return res.status(200).json({
      success: true,
      message: "Email verified successfully. You can now log in.",
    });
  } catch (error) {
    console.error("Verify email error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again later.",
    });
  }
}

// ── RESEND VERIFICATION EMAIL ─────────────────────────────────────

async function resendVerification(req, res) {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address.",
      });
    }

    // SECURITY: Always return the same message to prevent email enumeration
    const successMessage =
      "If an unverified account with that email exists, a new verification link has been sent.";

    const user = await User.findOne({ email });

    if (!user || user.isEmailVerified) {
      return res.status(200).json({ success: true, message: successMessage });
    }

    // Generate a new verification token
    const { raw: verifyRaw, hashed: verifyHashed } =
      generateVerificationToken();

    user.emailVerificationToken = verifyHashed;
    user.emailVerificationExpires = new Date(
      Date.now() + EMAIL_VERIFY_EXPIRY_MS
    );
    await user.save();

    if (env.nodeEnv !== "production") {
      console.log(
        `[DEV] Resent verification token for ${email}: ${verifyRaw}`
      );
    }

    return res.status(200).json({ success: true, message: successMessage });
  } catch (error) {
    console.error("Resend verification error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again later.",
    });
  }
}

// ── GET AUTH CONFIG (public) ───────────────────────────────────────

function getAuthConfig(req, res) {
  return res.status(200).json({
    success: true,
    googleClientId: env.googleClientId || null,
  });
}

// ── GET ME ─────────────────────────────────────────────────────────

async function getMe(req, res) {
  try {
    return res.status(200).json({
      success: true,
      user: sanitizeUser(req.user),
    });
  } catch (error) {
    console.error("Get profile error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again later.",
    });
  }
}

// ── UPDATE PROFILE ─────────────────────────────────────────────────

async function updateProfile(req, res) {
  try {
    const updates = {};

    if (req.body.fullName || req.body.name) {
      updates.name = String(req.body.fullName || req.body.name).trim();
      if (!isValidName(updates.name)) {
        return res.status(400).json({
          success: false,
          message: `Name must be 2–${NAME_MAX_LENGTH} characters and contain only letters, spaces, hyphens, or apostrophes.`,
        });
      }
    }

    if (req.body.course !== undefined) {
      updates.course = String(req.body.course).trim();
      if (!isValidProfileField(updates.course)) {
        return res.status(400).json({
          success: false,
          message: "Course contains invalid characters or is too long.",
        });
      }
    }

    if (req.body.semester !== undefined) {
      updates.semester = String(req.body.semester).trim();
      if (!isValidProfileField(updates.semester)) {
        return res.status(400).json({
          success: false,
          message: "Semester contains invalid characters or is too long.",
        });
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No fields to update.",
      });
    }

    const user = await User.findByIdAndUpdate(req.user._id, updates, {
      returnDocument: "after",
      runValidators: true,
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.error("Update profile error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again later.",
    });
  }
}

module.exports = {
  signup,
  login,
  googleLogin,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
  getAuthConfig,
  getMe,
  updateProfile,
};
