const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { isValidFilePath, isValidArticleKey } = require("../middleware/inputValidator");

const projectRoot = path.resolve(__dirname, "..", "..");
const frontendPublicDir = path.join(projectRoot, "frontend", "public");
const assetsDir = path.join(frontendPublicDir, "assets");
const booksDir = path.join(assetsDir, "books");
const bookCoversDir = path.join(assetsDir, "book-covers");
const mcqBundleFile = path.join(assetsDir, "js", "mcq-bundle.js");
const bookManifestFile = path.join(assetsDir, "js", "book-manifest.js");
const articleManifestFile = path.join(assetsDir, "data", "articles", "manifest.js");
const articleBundlesDir = path.join(assetsDir, "data", "articles");

const cache = {
  mcqBundle: null,
  bookManifest: null,
  articleManifest: null,
  articleBundles: new Map(),
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

module.exports = {
  getArticleHandler,
  getArticlesManifestHandler,
  getBookCoverHandler,
  getBookFileHandler,
  getBooksManifestHandler,
  getMcqBundle,
  getMcqBundleHandler,
};
