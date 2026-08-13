import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createApp } from "./app";
import { db, sql } from "./db/client";
import { redis, shutdownQueue } from "./services/queue";
import { loadEnv } from "./config/env";

const env = loadEnv();

await migrate(db, { migrationsFolder: "./drizzle" });

try {
  await redis.ping();
  console.log("[hog] redis connected");
} catch (err) {
  console.error("[hog] redis unavailable, search caching/queue degraded:", err);
}

const app = createApp();

const server = Bun.serve({
  port: env.PORT,
  fetch: app.fetch,
});

console.log(`hog listening on :${env.PORT}`);

async function shutdown() {
  await shutdownQueue();
  await sql.end();
  server.stop();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
