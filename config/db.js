const mongoose = require("mongoose");

const { env } = require("./env");

let lastConnectionError = null;

/**
 * Validates that the MONGO_URI uses TLS/SSL in production.
 * MongoDB Atlas requires SSL by default, but this check ensures
 * a misconfigured URI doesn't accidentally connect in plaintext.
 */
function validateMongoSecurity() {
  if (env.nodeEnv !== "production") {
    return; // Skip in development (local MongoDB may not use SSL)
  }

  const uri = env.mongoUri.toLowerCase();

  // Check for SSL/TLS in the connection string
  const hasSsl =
    uri.includes("ssl=true") ||
    uri.includes("tls=true") ||
    uri.startsWith("mongodb+srv://"); // SRV connections use TLS by default

  if (!hasSsl) {
    console.warn(
      "[SECURITY WARNING] MONGO_URI does not appear to use TLS/SSL. " +
        "In production, always connect to MongoDB over an encrypted channel. " +
        "Add 'ssl=true' or 'tls=true' to your connection string, or use " +
        "a mongodb+srv:// URI."
    );
  }

  // Warn if credentials are embedded in the URI (common but not ideal)
  if (uri.includes("@") && (uri.includes("://") && uri.split("://")[1].includes(":"))) {
    console.warn(
      "[SECURITY NOTE] MONGO_URI contains embedded credentials. " +
        "For maximum security, consider using MongoDB Atlas's IAM " +
        "authentication or environment-injected credentials."
    );
  }
}

async function connectDB() {
  if (!env.mongoUri) {
    lastConnectionError = new Error("MONGO_URI is not configured.");
    console.warn(
      "MongoDB connection skipped because MONGO_URI is not configured."
    );
    return null;
  }

  // Validate security before connecting
  validateMongoSecurity();

  try {
    const connection = await mongoose.connect(env.mongoUri, {
      maxPoolSize: 50,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      // Enforce TLS for production connections
      ...(env.nodeEnv === "production" ? { tls: true } : {}),
    });

    lastConnectionError = null;

    // Log connection info (redact credentials)
    const host = connection.connection.host;
    const dbName = connection.connection.name;
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "INFO",
        event: "DB_CONNECTED",
        host,
        database: dbName,
        tls: env.nodeEnv === "production" ? true : "not enforced (dev)",
      })
    );

    // Monitor connection events for security logging
    mongoose.connection.on("disconnected", () => {
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "WARN",
          event: "DB_DISCONNECTED",
          message: "MongoDB connection lost.",
        })
      );
    });

    mongoose.connection.on("reconnected", () => {
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "INFO",
          event: "DB_RECONNECTED",
          message: "MongoDB connection re-established.",
        })
      );
    });

    mongoose.connection.on("error", (err) => {
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "ERROR",
          event: "DB_ERROR",
          message: err.message,
        })
      );
    });

    return connection;
  } catch (error) {
    lastConnectionError = error;
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "ERROR",
        event: "DB_CONNECTION_FAILED",
        message: error.message,
      })
    );
    return null;
  }
}

function getDatabaseStatus() {
  const readyState = mongoose.connection.readyState;
  const labels = ["disconnected", "connected", "connecting", "disconnecting"];

  return {
    isConfigured: Boolean(env.mongoUri),
    isConnected: readyState === 1,
    readyState,
    state: labels[readyState] || "unknown",
    lastError: lastConnectionError ? lastConnectionError.message : null,
  };
}

process.on("SIGINT", async () => {
  await mongoose.connection.close();
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "INFO",
      event: "DB_SHUTDOWN",
      message: "MongoDB connection closed gracefully.",
    })
  );
  process.exit(0);
});

module.exports = { connectDB, getDatabaseStatus };
