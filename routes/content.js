const express = require("express");
const rateLimit = require("express-rate-limit");

const { protectRoute } = require("../middleware/auth");
const contentController = require("../controllers/contentController");
const testSeriesController = require("../controllers/testSeriesController");
const { logRateLimitHit } = require("../middleware/securityLogger");
const { botGuard } = require("../middleware/botGuard");

const router = express.Router();

// ── Rate limiter factory with security logging ─────────────────────

function contentRateLimiter({ windowMs, max, message, route }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message },
    handler(req, res, next, options) {
      logRateLimitHit(req, { route });
      res.status(options.statusCode).json(options.message);
    },
  });
}

// ── Per-route rate limiters ────────────────────────────────────────

// Book file downloads are the primary scraping target (full PDF files)
const bookFileLimiter = contentRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,                    // 30 book file downloads per 15 min
  message: "Too many book download requests. Please try again later.",
  route: "GET /api/content/books/file",
});

// Article retrieval limiter (prevents bulk scraping of encyclopedia)
const articleLimiter = contentRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,                    // 60 individual article lookups per 15 min
  message: "Too many article requests. Please try again later.",
  route: "GET /api/content/articles/article",
});

// Case study title list limiter (prevents scripted category scraping)
const caseStudyCategoryLimiter = contentRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: "Too many case study title requests. Please try again later.",
  route: "GET /api/content/case-studies/category/:categoryId",
});

// Case study detail limiter (full text content stays backend-served)
const caseStudyItemLimiter = contentRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: "Too many case study detail requests. Please try again later.",
  route: "GET /api/content/case-studies/category/:categoryId/item/:caseStudyId",
});

// Test series creation limiter (each attempt generates 120 questions)
const testCreateLimiter = contentRateLimiter({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 5,                     // 5 test attempts per hour
  message: "Too many test attempts. Please try again later.",
  route: "POST /api/content/test-series/attempt",
});

// Apply bot guard to all content routes (blocks scrapers)
router.use(botGuard({ speedCheck: true }));

// ── Content routes ─────────────────────────────────────────────────
router.get("/mcq/bundle", protectRoute, contentController.getMcqBundleHandler);
router.get(
  "/books/manifest",
  protectRoute,
  contentController.getBooksManifestHandler
);
router.get("/books/file", protectRoute, bookFileLimiter, contentController.getBookFileHandler);
router.get("/books/cover", protectRoute, contentController.getBookCoverHandler);
router.get(
  "/articles/manifest",
  protectRoute,
  contentController.getArticlesManifestHandler
);
router.get("/articles/article", protectRoute, articleLimiter, contentController.getArticleHandler);
router.get(
  "/case-studies/categories",
  protectRoute,
  contentController.getCaseStudyCategoriesHandler
);
router.get(
  "/case-studies/category/:categoryId",
  protectRoute,
  caseStudyCategoryLimiter,
  contentController.getCaseStudyCategoryHandler
);
router.get(
  "/case-studies/category/:categoryId/item/:caseStudyId",
  protectRoute,
  caseStudyItemLimiter,
  contentController.getCaseStudyItemHandler
);

// ── Test series routes ─────────────────────────────────────────────
router.get("/test-series/config", protectRoute, testSeriesController.getConfigHandler);
router.post("/test-series/attempt", protectRoute, testCreateLimiter, testSeriesController.createAttemptHandler);
router.get("/test-series/attempt/:attemptId", protectRoute, testSeriesController.getAttemptHandler);
router.post("/test-series/attempt/:attemptId/submit", protectRoute, testSeriesController.submitAttemptHandler);

module.exports = router;
