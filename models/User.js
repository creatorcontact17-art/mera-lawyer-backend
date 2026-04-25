const mongoose = require("mongoose");

/**
 * User Schema
 *
 * Indexes:
 *  - email: unique sparse index for fast O(log n) lookup across 25,000+ documents
 *
 * Design notes:
 *  - `resetPasswordToken` and `resetPasswordExpires` support the forgot-password flow
 *    without requiring a separate tokens collection.
 *  - `timestamps: true` adds createdAt / updatedAt automatically.
 *  - `course` and `semester` are optional profile fields for law students.
 *
 * Security notes (2026-04-25):
 *  - Password minimum raised from 6 → 8 characters.
 *  - `failedLoginAttempts` / `lockUntil` support per-account brute-force lockout.
 *  - `isEmailVerified` / `emailVerificationToken` / `emailVerificationExpires`
 *    scaffold future email-verification enforcement.
 */
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      minlength: [2, "Name must be at least 2 characters"],
      maxlength: [100, "Name cannot exceed 100 characters"],
    },

    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,          // Creates the unique index at schema level
      lowercase: true,       // Normalise before storing
      trim: true,
      match: [
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        "Please provide a valid email address",
      ],
    },

    password: {
      type: String,
      minlength: [8, "Password must be at least 8 characters"],
      // Never return the password field by default
      select: false,
    },

    googleId: {
      type: String,
      sparse: true,
      select: false,
    },

    course: {
      type: String,
      trim: true,
      maxlength: [100, "Course cannot exceed 100 characters"],
      default: "",
    },

    semester: {
      type: String,
      trim: true,
      maxlength: [20, "Semester cannot exceed 20 characters"],
      default: "",
    },

    // ── Forgot-password fields ────────────────────────────────────
    resetPasswordToken: {
      type: String,
      select: false,
    },
    resetPasswordExpires: {
      type: Date,
      select: false,
    },

    // ── Brute-force lockout ───────────────────────────────────────
    failedLoginAttempts: {
      type: Number,
      default: 0,
      select: false,
    },
    lockUntil: {
      type: Date,
      select: false,
    },

    // ── Email verification ─────────────────────────────────────
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    emailVerificationToken: {
      type: String,
      select: false,
    },
    emailVerificationExpires: {
      type: Date,
      select: false,
    },

    // ── JWT invalidation on password change ──────────────────────
    passwordChangedAt: {
      type: Date,
      select: false,
    },
  },
  {
    timestamps: true, // adds createdAt and updatedAt
  }
);

// ── Virtual: check if the account is currently locked ─────────────
userSchema.virtual("isLocked").get(function () {
  return Boolean(this.lockUntil && this.lockUntil > Date.now());
});

// ── Compound indexes for fast token lookups ───────────────────────
userSchema.index({ resetPasswordToken: 1, resetPasswordExpires: 1 });
userSchema.index({ emailVerificationToken: 1, emailVerificationExpires: 1 });

const User = mongoose.model("User", userSchema);

module.exports = User;
