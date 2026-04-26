/**
 * inputValidator — strict input validation helpers.
 *
 * All user input should pass through these validators before
 * being used in database queries, file operations, or API calls.
 *
 * Design principles:
 *  - Whitelist over blacklist: define what IS allowed
 *  - Fail closed: reject anything that doesn't match
 *  - Type coercion: always convert to expected type first
 */

// ── Email ──────────────────────────────────────────────────────────
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX_LENGTH = 254; // RFC 5321

function isValidEmail(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim().toLowerCase();
  return (
    trimmed.length > 0 &&
    trimmed.length <= EMAIL_MAX_LENGTH &&
    EMAIL_REGEX.test(trimmed)
  );
}

// ── Password ───────────────────────────────────────────────────────
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
const PASSWORD_MAX_LENGTH = 128; // bcrypt truncates at 72 bytes anyway

function isValidPassword(value) {
  if (typeof value !== "string") return false;
  return value.length <= PASSWORD_MAX_LENGTH && PASSWORD_REGEX.test(value);
}

// ── Name ───────────────────────────────────────────────────────────
// Allow letters, spaces, hyphens, apostrophes, periods (international names)
const NAME_REGEX = /^[\p{L}\p{M}'\-.\s]+$/u;
const NAME_MIN_LENGTH = 2;
const NAME_MAX_LENGTH = 100;

function isValidName(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return (
    trimmed.length >= NAME_MIN_LENGTH &&
    trimmed.length <= NAME_MAX_LENGTH &&
    NAME_REGEX.test(trimmed)
  );
}

// ── Hex token (reset password, email verification) ─────────────────
const HEX_TOKEN_REGEX = /^[a-f0-9]{64}$/;

function isValidHexToken(value) {
  if (typeof value !== "string") return false;
  return HEX_TOKEN_REGEX.test(value.trim());
}

// ── Course / Semester (profile fields) ─────────────────────────────
// Allow alphanumeric, spaces, hyphens, periods, parentheses
const PROFILE_FIELD_REGEX = /^[\w\s\-.()/,&]+$/;
const PROFILE_FIELD_MAX_LENGTH = 100;

function isValidProfileField(value) {
  if (typeof value !== "string") return true; // undefined is OK
  const trimmed = value.trim();
  if (trimmed.length === 0) return true; // Empty is OK (clearing the field)
  return (
    trimmed.length <= PROFILE_FIELD_MAX_LENGTH &&
    PROFILE_FIELD_REGEX.test(trimmed)
  );
}

// ── AI prompt ──────────────────────────────────────────────────────
const PROMPT_MIN_LENGTH = 2;
const PROMPT_MAX_LENGTH = 2000;

function isValidPrompt(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return (
    trimmed.length >= PROMPT_MIN_LENGTH &&
    trimmed.length <= PROMPT_MAX_LENGTH
  );
}

// ── File path (book downloads) ─────────────────────────────────────
// Only allow alphanumeric, hyphens, underscores, periods, forward slashes
// Reject: .., null bytes, backslashes, colons, semicolons
const SAFE_PATH_REGEX = /^[a-zA-Z0-9_\-./]+$/;
const DANGEROUS_PATH_PATTERNS = [
  /\.\./,        // Path traversal
  /\0/,          // Null byte
  /^\/+/,        // Leading slashes (absolute path)
  /\/{2,}/,      // Double slashes
];

function isValidFilePath(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 255) return false;
  if (!SAFE_PATH_REGEX.test(trimmed)) return false;
  return !DANGEROUS_PATH_PATTERNS.some((p) => p.test(trimmed));
}

// ── Article key (constitution articles) ────────────────────────────
// Article keys are like: "art-1", "art-14", "sch-1", "art-19-1-a"
const ARTICLE_KEY_REGEX = /^[a-z0-9\-]+$/;
const ARTICLE_KEY_MAX_LENGTH = 50;

function isValidArticleKey(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= ARTICLE_KEY_MAX_LENGTH &&
    ARTICLE_KEY_REGEX.test(trimmed)
  );
}

// —— Case study keys (categories and generated case ids) ————————————————
const CASE_STUDY_KEY_REGEX = /^[a-z0-9\-]+$/;
const CASE_STUDY_KEY_MAX_LENGTH = 160;

function isValidCaseStudyKey(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= CASE_STUDY_KEY_MAX_LENGTH &&
    CASE_STUDY_KEY_REGEX.test(trimmed)
  );
}

// ── Attempt ID (test series) ───────────────────────────────────────
// Format: "ts_<32 hex chars>"
const ATTEMPT_ID_REGEX = /^ts_[a-f0-9]{32}$/;

function isValidAttemptId(value) {
  if (typeof value !== "string") return false;
  return ATTEMPT_ID_REGEX.test(value.trim());
}

// ── Submit reason (test series) ────────────────────────────────────
const VALID_SUBMIT_REASONS = ["manual", "timeout", "violation", "auto"];

function isValidSubmitReason(value) {
  if (typeof value !== "string") return false;
  return VALID_SUBMIT_REASONS.includes(value.trim().toLowerCase());
}

// ── Google credential (JWT token) ──────────────────────────────────
// Google ID tokens are JWTs: three base64url segments separated by dots
const JWT_REGEX = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const GOOGLE_CREDENTIAL_MAX_LENGTH = 4096;

function isValidGoogleCredential(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= GOOGLE_CREDENTIAL_MAX_LENGTH &&
    JWT_REGEX.test(trimmed)
  );
}

// ── Generic string length check ────────────────────────────────────
function enforceMaxLength(value, maxLen) {
  if (typeof value !== "string") return "";
  return value.length > maxLen ? value.substring(0, maxLen) : value;
}

module.exports = {
  ARTICLE_KEY_MAX_LENGTH,
  CASE_STUDY_KEY_MAX_LENGTH,
  ATTEMPT_ID_REGEX,
  EMAIL_MAX_LENGTH,
  GOOGLE_CREDENTIAL_MAX_LENGTH,
  NAME_MAX_LENGTH,
  NAME_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_REGEX,
  PROMPT_MAX_LENGTH,
  PROMPT_MIN_LENGTH,
  VALID_SUBMIT_REASONS,
  enforceMaxLength,
  isValidArticleKey,
  isValidAttemptId,
  isValidCaseStudyKey,
  isValidEmail,
  isValidFilePath,
  isValidGoogleCredential,
  isValidHexToken,
  isValidName,
  isValidPassword,
  isValidProfileField,
  isValidPrompt,
  isValidSubmitReason,
};
