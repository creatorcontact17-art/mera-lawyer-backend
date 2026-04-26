const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  isValidArticleKey,
  isValidCaseStudyKey,
  isValidFilePath,
} = require("../middleware/inputValidator");

// Content is served from backend/content/ (bundled with the backend deployment).
// This directory mirrors the frontend's assets structure so the same manifest
// and file-resolution logic works in both local dev and production.
const contentDir = path.resolve(__dirname, "..", "content");
const booksDir = path.join(contentDir, "books");
const bookCoversDir = path.join(contentDir, "book-covers");
const mcqBundleFile = path.join(contentDir, "js", "mcq-bundle.js");
const bookManifestFile = path.join(contentDir, "js", "book-manifest.js");
const articleManifestFile = path.join(contentDir, "data", "articles", "manifest.js");
const articleBundlesDir = path.join(contentDir, "data", "articles");
const caseStudiesDir = path.join(contentDir, "data", "case-studies");
const caseStudyManifestFile = path.join(caseStudiesDir, "manifest.json");

const cache = {
  mcqBundle: null,
  bookManifest: null,
  articleManifest: null,
  articleBundles: new Map(),
  caseStudyManifest: null,
  caseStudyCategories: new Map(),
};

function setPrivateResponseHeaders(res) {
  res.set("Cache-Control", "private, no-store, max-age=0");
  res.set("Pragma", "no-cache");
}

function runWindowScript(filePath) {
  const code = fs.readFileSync(filePath, "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(code, sandbox, {
    filename: filePath,
    displayErrors: true,
  });
  return sandbox.window;
}

function normalizeManifestAssetPath(filePath, expectedPrefix) {
  const normalized = String(filePath || "")
    .replace(/^\.\//, "")
    .replace(/\\/g, "/")
    .trim();

  if (!normalized || !normalized.startsWith(expectedPrefix)) {
    return "";
  }

  return normalized.slice(expectedPrefix.length);
}

function resolveSafeFile(rootDir, relativePath) {
  const cleaned = String(relativePath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .trim();

  if (!cleaned) {
    return null;
  }

  const resolved = path.resolve(rootDir, cleaned);
  const normalizedRoot = path.resolve(rootDir);
  const isInsideRoot = resolved === normalizedRoot || resolved.startsWith(`${normalizedRoot}${path.sep}`);

  if (!isInsideRoot) {
    return null;
  }

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return null;
  }

  return resolved;
}

function getMcqBundle() {
  if (!cache.mcqBundle) {
    const windowValues = runWindowScript(mcqBundleFile);
    cache.mcqBundle = windowValues.__MeraLawyerMcqBundle || { sections: [] };
  }

  return cache.mcqBundle;
}

function getBookManifest() {
  if (!cache.bookManifest) {
    const windowValues = runWindowScript(bookManifestFile);
    const manifest = windowValues.MeraLawyerBookManifest || {
      books: [],
      categories: [],
      count: 0,
    };

    cache.bookManifest = {
      ...manifest,
      books: Array.isArray(manifest.books)
        ? manifest.books.map((book) => {
            const { pdfUrl, coverImageUrl, ...rest } = book;
            return {
              ...rest,
              coverRelativePath: normalizeManifestAssetPath(
                coverImageUrl,
                "assets/book-covers/"
              ),
            };
          })
        : [],
    };
  }

  return cache.bookManifest;
}

function getArticleManifest() {
  if (!cache.articleManifest) {
    const windowValues = runWindowScript(articleManifestFile);
    cache.articleManifest = {
      index: Array.isArray(windowValues.__CONSTITUTION_ARTICLE_INDEX)
        ? windowValues.__CONSTITUTION_ARTICLE_INDEX
        : [],
      bundleMap:
        windowValues.__CONSTITUTION_ARTICLE_BUNDLE_MAP &&
        typeof windowValues.__CONSTITUTION_ARTICLE_BUNDLE_MAP === "object"
          ? windowValues.__CONSTITUTION_ARTICLE_BUNDLE_MAP
          : {},
    };
  }

  return cache.articleManifest;
}

function getArticleBundle(bundleName) {
  if (!cache.articleBundles.has(bundleName)) {
    const resolvedPath = resolveSafeFile(articleBundlesDir, bundleName);

    if (!resolvedPath) {
      return null;
    }

    const windowValues = runWindowScript(resolvedPath);
    cache.articleBundles.set(
      bundleName,
      windowValues.__CONSTITUTION_ARTICLES || {}
    );
  }

  return cache.articleBundles.get(bundleName) || null;
}

function getArticleByKey(articleKey) {
  const manifest = getArticleManifest();
  const bundleName = manifest.bundleMap[articleKey];

  if (!bundleName) {
    return null;
  }

  const bundle = getArticleBundle(bundleName);
  if (!bundle) {
    return null;
  }

  return bundle[articleKey] || null;
}

function readJsonFile(filePath, fallbackValue) {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === "object" ? parsed : fallbackValue;
}

function getCaseStudyManifest() {
  if (!cache.caseStudyManifest) {
    const manifest = readJsonFile(caseStudyManifestFile, { categories: [] });
    cache.caseStudyManifest = {
      categories: Array.isArray(manifest.categories) ? manifest.categories : [],
    };
  }

  return cache.caseStudyManifest;
}

function getCaseStudyCategory(categoryId) {
  if (!cache.caseStudyCategories.has(categoryId)) {
    const resolvedPath = resolveSafeFile(caseStudiesDir, `${categoryId}.json`);

    if (!resolvedPath) {
      return null;
    }

    const payload = readJsonFile(resolvedPath, null);
    const isValidPayload =
      payload &&
      typeof payload === "object" &&
      payload.id === categoryId &&
      typeof payload.title === "string" &&
      Array.isArray(payload.cases);

    cache.caseStudyCategories.set(categoryId, isValidPayload ? payload : null);
  }

  return cache.caseStudyCategories.get(categoryId) || null;
}

function getCaseStudyItem(categoryId, caseStudyId) {
  const category = getCaseStudyCategory(categoryId);

  if (!category || !Array.isArray(category.cases)) {
    return null;
  }

  return (
    category.cases.find((item) => item && item.id === caseStudyId) || null
  );
}

function sendMissingFile(res, message) {
  return res.status(404).json({
    success: false,
    message,
  });
}

function getMcqBundleHandler(req, res) {
  try {
    setPrivateResponseHeaders(res);
    return res.status(200).json({
      success: true,
      bundle: getMcqBundle(),
    });
  } catch (error) {
    console.error("MCQ bundle load error:", error);
    return res.status(500).json({
      success: false,
      message: "MCQ bundle could not be loaded.",
    });
  }
}

function getBooksManifestHandler(req, res) {
  try {
    setPrivateResponseHeaders(res);
    return res.status(200).json({
      success: true,
      manifest: getBookManifest(),
    });
  } catch (error) {
    console.error("Book manifest load error:", error);
    return res.status(500).json({
      success: false,
      message: "Book manifest could not be loaded.",
    });
  }
}

function getBookFileHandler(req, res) {
  const rawPath = String(req.query.path || "").trim();

  if (!rawPath || !isValidFilePath(rawPath)) {
    return sendMissingFile(res, "Invalid book file path.");
  }

  // Only allow PDF files
  const ext = path.extname(rawPath).toLowerCase();
  if (ext !== ".pdf") {
    return sendMissingFile(res, "Only PDF files can be downloaded.");
  }

  const absolutePath = resolveSafeFile(booksDir, rawPath);

  if (!absolutePath) {
    return sendMissingFile(res, "Requested book file was not found.");
  }

  setPrivateResponseHeaders(res);
  res.type(path.extname(absolutePath));
  // Force inline display to prevent browsers (especially Safari on Mac)
  // from auto-downloading the PDF instead of displaying it
  res.set("Content-Disposition", "inline");
  res.set("X-Content-Type-Options", "nosniff");
  res.sendFile(absolutePath);
}

function getBookCoverHandler(req, res) {
  const rawPath = String(req.query.path || "").trim();

  if (!rawPath || !isValidFilePath(rawPath)) {
    return sendMissingFile(res, "Invalid book cover path.");
  }

  // Only allow image files
  const ext = path.extname(rawPath).toLowerCase();
  const allowedImageExts = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"];
  if (!allowedImageExts.includes(ext)) {
    return sendMissingFile(res, "Only image files are allowed.");
  }

  const absolutePath = resolveSafeFile(bookCoversDir, rawPath);

  if (!absolutePath) {
    return sendMissingFile(res, "Requested book cover was not found.");
  }

  setPrivateResponseHeaders(res);
  res.type(path.extname(absolutePath));
  res.sendFile(absolutePath);
}

function getArticlesManifestHandler(req, res) {
  try {
    setPrivateResponseHeaders(res);
    const manifest = getArticleManifest();
    return res.status(200).json({
      success: true,
      index: manifest.index,
    });
  } catch (error) {
    console.error("Article manifest load error:", error);
    return res.status(500).json({
      success: false,
      message: "Constitution article manifest could not be loaded.",
    });
  }
}

function getArticleHandler(req, res) {
  try {
    const articleKey = String(req.query.item || "").trim();

    if (!articleKey || !isValidArticleKey(articleKey)) {
      return res.status(400).json({
        success: false,
        message: "Invalid article key. Use lowercase letters, numbers, and hyphens only.",
      });
    }

    const article = getArticleByKey(articleKey);

    if (!article) {
      return sendMissingFile(res, "Requested article was not found.");
    }

    setPrivateResponseHeaders(res);
    return res.status(200).json({
      success: true,
      article,
    });
  } catch (error) {
    console.error("Article load error:", error);
    return res.status(500).json({
      success: false,
      message: "Constitution article could not be loaded.",
    });
  }
}

function getCaseStudyCategoriesHandler(req, res) {
  try {
    setPrivateResponseHeaders(res);
    const manifest = getCaseStudyManifest();
    return res.status(200).json({
      success: true,
      categories: manifest.categories,
    });
  } catch (error) {
    console.error("Case study manifest load error:", error);
    return res.status(500).json({
      success: false,
      message: "Case study categories could not be loaded.",
    });
  }
}

function getCaseStudyCategoryHandler(req, res) {
  try {
    const categoryId = String(req.params.categoryId || "").trim();

    if (!categoryId || !isValidCaseStudyKey(categoryId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid case study category.",
      });
    }

    const category = getCaseStudyCategory(categoryId);

    if (!category) {
      return sendMissingFile(res, "Requested case study category was not found.");
    }

    setPrivateResponseHeaders(res);
    return res.status(200).json({
      success: true,
      category: {
        id: category.id,
        title: category.title,
        totalCases: category.totalCases,
      },
      cases: Array.isArray(category.cases)
        ? category.cases.map((item) => ({
            id: item.id,
            title: item.title,
          }))
        : [],
    });
  } catch (error) {
    console.error("Case study category load error:", error);
    return res.status(500).json({
      success: false,
      message: "Case study titles could not be loaded.",
    });
  }
}

function getCaseStudyItemHandler(req, res) {
  try {
    const categoryId = String(req.params.categoryId || "").trim();
    const caseStudyId = String(req.params.caseStudyId || "").trim();

    if (!categoryId || !isValidCaseStudyKey(categoryId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid case study category.",
      });
    }

    if (!caseStudyId || !isValidCaseStudyKey(caseStudyId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid case study id.",
      });
    }

    const caseStudy = getCaseStudyItem(categoryId, caseStudyId);

    if (!caseStudy) {
      return sendMissingFile(res, "Requested case study was not found.");
    }

    setPrivateResponseHeaders(res);
    return res.status(200).json({
      success: true,
      caseStudy: {
        id: caseStudy.id,
        title: caseStudy.title,
        facts: caseStudy.facts,
        issues: caseStudy.issues,
        arguments: caseStudy.arguments,
        judgment: caseStudy.judgment,
        reasoning: caseStudy.reasoning,
        legalPrinciples: caseStudy.legalPrinciples,
      },
    });
  } catch (error) {
    console.error("Case study item load error:", error);
    return res.status(500).json({
      success: false,
      message: "Case study could not be loaded.",
    });
  }
}

module.exports = {
  getArticleHandler,
  getArticlesManifestHandler,
  getBookCoverHandler,
  getBookFileHandler,
  getBooksManifestHandler,
  getCaseStudyCategoriesHandler,
  getCaseStudyCategoryHandler,
  getCaseStudyItemHandler,
  getMcqBundle,
  getMcqBundleHandler,
};
