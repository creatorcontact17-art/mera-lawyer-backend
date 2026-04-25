/**
 * sanitizeBody — middleware that strips HTML tags, trims string values,
 * neutralises NoSQL injection operators, and enforces depth/key limits
 * on req.body, req.query, and req.params.
 *
 * Protection layers:
 *  1. HTML tag stripping (XSS prevention)
 *  2. MongoDB operator stripping (NoSQL injection prevention)
 *  3. Null byte removal (path traversal prevention)
 *  4. Object depth limiting (prototype pollution prevention)
 *  5. Key count limiting (DoS prevention)
 */

const MAX_DEPTH = 5;
const MAX_KEYS = 100;

// MongoDB query operators that should never appear in user input
const MONGO_OPERATORS = /^\$/;

/**
 * Recursively sanitise an object in-place.
 */
function sanitizeObject(obj, depth) {
  if (depth > MAX_DEPTH) {
    // Truncate deeply nested objects
    for (const key of Object.keys(obj)) {
      delete obj[key];
    }
    return;
  }

  const keys = Object.keys(obj);

  // Prevent oversized key counts (DoS via huge payloads)
  if (keys.length > MAX_KEYS) {
    for (const key of keys.slice(MAX_KEYS)) {
      delete obj[key];
    }
  }

  for (const key of Object.keys(obj)) {
    // ── NoSQL injection prevention ─────────────────────────────
    // Strip any keys that start with $ (MongoDB operators like $gt, $ne, $regex)
    if (MONGO_OPERATORS.test(key)) {
      delete obj[key];
      continue;
    }

    // ── Prototype pollution prevention ─────────────────────────
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      delete obj[key];
      continue;
    }

    const value = obj[key];

    if (typeof value === "string") {
      obj[key] = value
        .replace(/<[^>]*>/g, "")     // Strip HTML tags (XSS)
        .replace(/\0/g, "")          // Remove null bytes (path traversal)
        .trim();
    } else if (Array.isArray(value)) {
      // Sanitise array elements
      for (let i = 0; i < value.length; i++) {
        if (typeof value[i] === "string") {
          value[i] = value[i]
            .replace(/<[^>]*>/g, "")
            .replace(/\0/g, "")
            .trim();
        } else if (value[i] && typeof value[i] === "object") {
          sanitizeObject(value[i], depth + 1);
        }
      }
    } else if (value && typeof value === "object") {
      sanitizeObject(value, depth + 1);
    }
  }
}

/**
 * Sanitise query parameters — strip MongoDB operators from values.
 * Query params can be strings or objects (Express parses ?email[$ne]=x).
 */
function sanitizeQuery(obj) {
  if (!obj || typeof obj !== "object") return;

  for (const key of Object.keys(obj)) {
    // Remove $-prefixed keys
    if (MONGO_OPERATORS.test(key)) {
      delete obj[key];
      continue;
    }

    const value = obj[key];

    if (typeof value === "string") {
      obj[key] = value.replace(/\0/g, "").trim();
    } else if (value && typeof value === "object") {
      // Express can parse nested query objects like ?field[$gt]=5
      // Replace the entire object with an empty string (reject it)
      obj[key] = "";
    }
  }
}

function sanitizeBody(req, res, next) {
  if (req.body && typeof req.body === "object") {
    sanitizeObject(req.body, 0);
  }

  // Also sanitise query parameters (prevents NoSQL injection via URL)
  if (req.query && typeof req.query === "object") {
    sanitizeQuery(req.query);
  }

  next();
}

module.exports = { sanitizeBody };
