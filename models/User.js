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
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters"],
      // Never return the password field by default
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

    // Forgot-password fields (no separate collection needed)
    resetPasswordToken: {
      type: String,
      select: false,
    },
    resetPasswordExpires: {
      type: Date,
      select: false,
    },
  },
  {
    timestamps: true, // adds createdAt and updatedAt
  }
);

// ── Compound index for fast password-reset token lookups ──────────────────────
userSchema.index({ resetPasswordToken: 1, resetPasswordExpires: 1 });

const User = mongoose.model("User", userSchema);

module.exports = User;
