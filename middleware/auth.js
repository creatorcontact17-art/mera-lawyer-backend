const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { env } = require("../config/env");

/**
 * protectRoute — middleware that validates a Bearer JWT token.
 *
 * Usage:
 *   router.get("/profile", protectRoute, profileController);
 *
 * The decoded payload is attached to `req.user` for downstream handlers.
 */
const protectRoute = async (req, res, next) => {
  let token;

  // 1. Extract token from Authorization header
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer ")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Access denied. No token provided.",
    });
  }

  try {
    // 2. Verify token signature and expiry
    const decoded = jwt.verify(token, env.jwtSecret);

    // 3. Fetch user from DB to ensure the account still exists
    //    .select("-password") is redundant here (select:false on schema),
    //    but kept for explicit clarity.
    const user = await User.findById(decoded.id).select("-password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Token is valid but user no longer exists.",
      });
    }

    // 4. Attach user to request object
    req.user = user;
    next();
  } catch (error) {
    // Distinguish expired tokens from malformed ones for better DX
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Session expired. Please log in again.",
      });
    }

    return res.status(401).json({
      success: false,
      message: "Invalid token.",
    });
  }
};

module.exports = { protectRoute };
