/**
 * botGuard — middleware to detect and block automated/bot traffic.
 *
 * Checks performed:
 *   1. User-Agent presence and validity
 *   2. Known bot/scraper User-Agent patterns
 *   3. Abnormally fast sequential requests (speed fingerprinting)
 *
 * This is a lightweight, zero-dependency heuristic layer. For
 * production-grade bot protection, consider Cloudflare Bot Management
 * or reCAPTCHA Enterprise.
 */

const { logSuspiciousActivity, getClientIp } = require("./securityLogger");

// ── Known bot/scraper User-Agent patterns ──────────────────────────
const BOT_PATTERNS = [
  /curl\//i,
  /wget\//i,
  /python-requests/i,
  /python-urllib/i,
  /httpie/i,
  /postmanruntime/i,
  /insomnia\//i,
  /scrapy/i,
  /phantomjs/i,
  /headlesschrome/i,
  /selenium/i,
  /puppeteer/i,
  /playwright/i,
  /go-http-client/i,
  /java\//i,
  /libwww-perl/i,
  /axios\//i,
  /node-fetch/i,
  /undici/i,
  /http\.rb/i,
  /ruby/i,
  /aiohttp/i,
  /okhttp/i,
];

// Whitelist patterns for legitimate bots (search engines, health checks)
const ALLOWED_BOT_PATTERNS = [
  /googlebot/i,
  /bingbot/i,
  /uptimerobot/i,
  /render/i,
];

// ── Speed fingerprinting store ─────────────────────────────────────
// Tracks timestamps of the last request per IP to detect automated bursts.
const requestTimestamps = new Map();
const SPEED_WINDOW_MS = 500; // Minimum ms between requests from same IP
const SPEED_MAX_HITS = 10;   // Max rapid requests before blocking
const SPEED_DECAY_MS = 60 * 1000; // Clear speed counter after 1 minute

// Periodic cleanup of stale speed entries
setInterval(() => {
  const now = Date.now();
  requestTimestamps.forEach((entry, ip) => {
    if (now - entry.lastSeen > SPEED_DECAY_MS) {
      requestTimestamps.delete(ip);
    }
  });
}, 30 * 1000); // Clean every 30 seconds

/**
 * Core bot detection middleware.
 * Apply to API routes that need protection against scraping.
 *
 * @param {Object} options
 * @param {boolean} options.blockMissingUA   - Block requests with no User-Agent (default: true)
 * @param {boolean} options.blockKnownBots   - Block known bot UAs (default: true)
 * @param {boolean} options.speedCheck       - Enable speed fingerprinting (default: true)
 */
function botGuard(options = {}) {
  const {
    blockMissingUA = true,
    blockKnownBots = true,
    speedCheck = true,
  } = options;

  return (req, res, next) => {
    const ua = req.headers["user-agent"] || "";
    const ip = getClientIp(req);

    // 1. Missing User-Agent
    if (blockMissingUA && !ua.trim()) {
      logSuspiciousActivity(req, {
        reason: "Missing User-Agent header",
        details: "Requests without User-Agent are typically automated scripts.",
      });
      return res.status(403).json({
        success: false,
        message: "Forbidden.",
      });
    }

    // 2. Known bot User-Agents
    if (blockKnownBots && ua) {
      // Skip whitelisted bots
      const isAllowed = ALLOWED_BOT_PATTERNS.some((p) => p.test(ua));
      if (!isAllowed) {
        const isBot = BOT_PATTERNS.some((p) => p.test(ua));
        if (isBot) {
          logSuspiciousActivity(req, {
            reason: "Known bot/scraper User-Agent detected",
            details: ua.substring(0, 120),
          });
          return res.status(403).json({
            success: false,
            message: "Forbidden.",
          });
        }
      }
    }

    // 3. Speed fingerprinting — detect automated request bursts
    if (speedCheck) {
      const now = Date.now();
      let entry = requestTimestamps.get(ip);

      if (!entry) {
        entry = { rapidCount: 0, lastSeen: now };
        requestTimestamps.set(ip, entry);
      } else {
        const gap = now - entry.lastSeen;
        entry.lastSeen = now;

        if (gap < SPEED_WINDOW_MS) {
          entry.rapidCount += 1;

          if (entry.rapidCount >= SPEED_MAX_HITS) {
            logSuspiciousActivity(req, {
              reason: "Automated rapid-fire request burst",
              details: `${entry.rapidCount} requests within ${SPEED_WINDOW_MS}ms intervals from ${ip}`,
            });
            return res.status(429).json({
              success: false,
              message: "Too many requests. Please slow down.",
            });
          }
        } else {
          // Gap is normal, reset counter
          entry.rapidCount = 0;
        }
      }
    }

    next();
  };
}

module.exports = { botGuard };
