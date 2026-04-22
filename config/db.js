const mongoose = require("mongoose");

const { env } = require("./env");

let lastConnectionError = null;

async function connectDB() {
  if (!env.mongoUri) {
    lastConnectionError = new Error("MONGO_URI is not configured.");
    console.warn(
      "MongoDB connection skipped because MONGO_URI is not configured."
    );
    return null;
  }

  try {
    const connection = await mongoose.connect(env.mongoUri, {
      maxPoolSize: 50,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    lastConnectionError = null;
    console.log(`MongoDB connected: ${connection.connection.host}`);
    return connection;
  } catch (error) {
    lastConnectionError = error;
    console.error(`MongoDB connection error: ${error.message}`);
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
  console.log("MongoDB connection closed.");
  process.exit(0);
});

module.exports = { connectDB, getDatabaseStatus };
