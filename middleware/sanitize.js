/**
 * sanitizeBody — middleware that strips HTML tags and trims string values
 * from req.body to prevent basic XSS through stored input.
 *
 * This is a lightweight defence layer. For production, consider a library
 * like express-validator or sanitize-html.
 */
function sanitizeBody(req, res, next) {
  if (req.body && typeof req.body === "object") {
    sanitizeObject(req.body);
  }

  next();
}

function sanitizeObject(obj) {
  for (const key of Object.keys(obj)) {
    const value = obj[key];

    if (typeof value === "string") {
      // Strip HTML tags and trim whitespace
      obj[key] = value.replace(/<[^>]*>/g, "").trim();
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      sanitizeObject(value);
    }
  }
}

module.exports = { sanitizeBody };
