import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sql } from "./db/client";
import { redis, startEmailWorker } from "./services/email-worker";
import { loadEnv } from "./config/env";

const env = loadEnv();

await migrate(db, { migrationsFolder: "./drizzle" });

try {
  await redis.ping();
  console.log("[pigeon] redis connected");
} catch (err) {
  console.error("[pigeon] redis unavailable, email provisioning degraded:", err);
}

const worker = startEmailWorker();
console.log("pigeon (email provisioning worker) consuming queue: email-jobs");

async function shutdown() {
  await worker.close();
  redis.disconnect();
  await sql.end();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);