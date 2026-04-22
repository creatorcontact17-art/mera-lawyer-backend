const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const User = require("../models/User");
const { env } = require("../config/env");

const SALT_ROUNDS = 12;

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
    status: "Active",
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.updatedAt,
  };
}

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

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters.",
      });
    }

    const existingUser = await User.findOne({ email }).lean();
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await User.create({
      name,
      email,
      password: hashedPassword,
    });

    const token = generateToken(user._id);
    const totalUsers = await User.countDocuments();

    return res.status(201).json({
      success: true,
      message: "Account created successfully.",
      token,
      user: sanitizeUser(user),
      stats: {
        totalUsers,
        dbStatus: "MongoDB connected",
        sessionMode: "Bearer JWT",
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    console.error("Signup error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again later.",
    });
  }
}

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

    const user = await User.findOne({ email }).select("+password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const token = generateToken(user._id);
    const totalUsers = await User.countDocuments();

    return res.status(200).json({
      success: true,
      message: "Login successful.",
      token,
      user: sanitizeUser(user),
      stats: {
        totalUsers,
        dbStatus: "MongoDB connected",
        sessionMode: "Bearer JWT",
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again later.",
    });
  }
}

async function forgotPassword(req, res) {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Please provide your email address.",
      });
    }

    const user = await User.findOne({ email });
    if (!user) {
      // Don't reveal whether the email exists
      return res.status(200).json({
        success: true,
        message:
          "If an account with that email exists, a reset token has been sent.",
      });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    user.resetPasswordToken = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");
    user.resetPasswordExpires = Date.now() + 15 * 60 * 1000;

    await user.save();

    return res.status(200).json({
      success: true,
      message:
        "If an account with that email exists, a reset token has been sent.",
      devResetToken:
        env.nodeEnv === "production" ? undefined : resetToken,
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again later.",
    });
  }
}

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

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 6 characters.",
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

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Password reset successful. You can now log in.",
      token: generateToken(user._id),
    });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again later.",
    });
  }
}

async function getMe(req, res) {
  try {
    const totalUsers = await User.countDocuments();

    return res.status(200).json({
      success: true,
      user: sanitizeUser(req.user),
      stats: {
        totalUsers,
        dbStatus: "MongoDB connected",
        sessionMode: "Bearer JWT",
      },
    });
  } catch (error) {
    console.error("Get profile error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again later.",
    });
  }
}

async function updateProfile(req, res) {
  try {
    const updates = {};

    if (req.body.fullName || req.body.name) {
      updates.name = String(req.body.fullName || req.body.name).trim();
      if (updates.name.length < 2) {
        return res.status(400).json({
          success: false,
          message: "Name must be at least 2 characters.",
        });
      }
    }

    if (req.body.course !== undefined) {
      updates.course = String(req.body.course).trim();
    }

    if (req.body.semester !== undefined) {
      updates.semester = String(req.body.semester).trim();
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

    const totalUsers = await User.countDocuments();

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      user: sanitizeUser(user),
      stats: {
        totalUsers,
        dbStatus: "MongoDB connected",
        sessionMode: "Bearer JWT",
      },
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
  forgotPassword,
  resetPassword,
  getMe,
  updateProfile,
};
