const { env } = require("../config/env");

/**
 * enforceHttps — redirects HTTP → HTTPS in production.
 *
 * Behind reverse proxies (Render, Heroku, AWS ALB), the original
 * protocol is forwarded in the `x-forwarded-proto` header.
 * This middleware checks that header and issues a 301 redirect
 * if the request arrived over plain HTTP.
 *
 * In development mode, this middleware is a no-op.
 */
function enforceHttps(req, res, next) {
  // Skip in non-production environments
  if (env.nodeEnv !== "production") {
    return next();
  }

  // Check the x-forwarded-proto header set by the reverse proxy
  const proto = (req.headers["x-forwarded-proto"] || "").split(",")[0].trim();

  if (proto === "http") {
    // 301 permanent redirect to HTTPS
    const secureUrl = `https://${req.hostname}${req.originalUrl}`;
    return res.redirect(301, secureUrl);
  }

  next();
}

module.exports = { enforceHttps };
