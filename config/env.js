const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

function parsePort(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOrigins(value) {
  if (!value) {
    return ["*"];
  }

  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV || "development",
  port: parsePort(process.env.PORT, 4000),
  mongoUri: (process.env.MONGO_URI || "").trim(),
  jwtSecret: (process.env.JWT_SECRET || "").trim(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  clientOrigins: parseOrigins(process.env.CLIENT_ORIGIN),

  // AI provider: "gemini" (Google), "groq" (cloud, free), or "ollama" (local)
  aiProvider: (process.env.AI_PROVIDER || "gemini").trim().toLowerCase(),
  aiModel: (process.env.AI_MODEL || "llama-3.3-70b-versatile").trim(),

  // Groq cloud API (free tier)
  groqApiKey: (process.env.GROQ_API_KEY || "").trim(),

  // Google Gemini API
  geminiApiKey: (process.env.GEMINI_API_KEY || "").trim(),

  // Ollama local (fallback for local dev)
  ollamaApiUrl: (process.env.OLLAMA_API_URL || "http://localhost:11434/api/generate").trim(),

  // Google OAuth
  googleClientId: (process.env.GOOGLE_CLIENT_ID || "").trim(),
});

function validateEnv() {
  const missing = [];

  if (!env.jwtSecret) {
    missing.push("JWT_SECRET");
  } else if (env.jwtSecret.length < 32) {
    throw new Error(
      "JWT_SECRET is too short (" +
        env.jwtSecret.length +
        " chars). Use at least 32 characters.\n" +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"'
    );
  }

  if (!env.mongoUri) {
    missing.push("MONGO_URI");
  }

  if (env.aiProvider === "groq" && !env.groqApiKey) {
    missing.push("GROQ_API_KEY");
  }

  if (env.aiProvider === "gemini" && !env.geminiApiKey) {
    missing.push("GEMINI_API_KEY");
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }
}

module.exports = { env, validateEnv };
