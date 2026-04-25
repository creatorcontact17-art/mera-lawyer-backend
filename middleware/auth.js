const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { env } = require("../config/env");
const { logTokenRejected } = require("./securityLogger");

/**
 * protectRoute — middleware that validates a Bearer JWT token.
 *
 * Usage:
 *   router.get("/profile", protectRoute, profileController);
 *
 * The decoded payload is attached to `req.user` for downstream handlers.
 *
 * Security checks (in order):
 *   1. Token exists in Authorization header
 *   2. Token signature and expiry are valid
 *   3. User still exists in the database
 *   4. Token was not issued before the last password change
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
    //    Also fetch passwordChangedAt for JWT invalidation check.
    const user = await User.findById(decoded.id).select(
      "-password +passwordChangedAt"
    );

    if (!user) {
      logTokenRejected(req, { reason: "user_deleted" });
      return res.status(401).json({
        success: false,
        message: "Token is valid but user no longer exists.",
      });
    }

    // 4. Check if the password was changed after the JWT was issued.
    //    If so, the token is stale and the user must re-authenticate.
    if (user.passwordChangedAt) {
      // JWT `iat` is in seconds; passwordChangedAt is a Date (milliseconds)
      const changedAtSeconds = Math.floor(
        user.passwordChangedAt.getTime() / 1000
      );

      if (decoded.iat < changedAtSeconds) {
        logTokenRejected(req, { reason: "password_changed" });
        return res.status(401).json({
          success: false,
          message:
            "Password was recently changed. Please log in again.",
        });
      }
    }

    // 5. Attach user to request object
    req.user = user;
    next();
  } catch (error) {
    // Distinguish expired tokens from malformed ones for better DX
    if (error.name === "TokenExpiredError") {
      logTokenRejected(req, { reason: "token_expired" });
      return res.status(401).json({
        success: false,
        message: "Session expired. Please log in again.",
      });
    }

    logTokenRejected(req, { reason: "invalid_token" });
    return res.status(401).json({
      success: false,
      message: "Invalid token.",
    });
  }
};

module.exports = { protectRoute };
