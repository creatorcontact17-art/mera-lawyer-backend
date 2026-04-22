const { getDatabaseStatus } = require("../config/db");

function requireDatabase(req, res, next) {
  const database = getDatabaseStatus();

  if (database.isConnected) {
    next();
    return;
  }

  res.status(503).json({
    success: false,
    message: database.isConfigured
      ? "Database is currently unavailable. Start MongoDB and retry."
      : "MONGO_URI is missing. Update backend/.env before using auth routes.",
    database,
  });
}

module.exports = { requireDatabase };
