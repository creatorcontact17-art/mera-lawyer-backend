const { validateEnv } = require("./config/env");
const { connectDB } = require("./config/db");

validateEnv();

async function main() {
  const connection = await connectDB();

  if (!connection) {
    console.error("Failed to connect to MongoDB. Exiting.");
    process.exit(1);
  }

  const app = require("./app");
  const { env } = require("./config/env");

  app.listen(env.port, () => {
    console.log(`Mera Lawyer API running on http://localhost:${env.port}`);
    console.log(`Health check: http://localhost:${env.port}/health`);
    console.log(`API index:    http://localhost:${env.port}/api`);
    console.log(`Environment:  ${env.nodeEnv}`);
  });
}

main().catch((error) => {
  console.error("Fatal startup error:", error);
  process.exit(1);
});
