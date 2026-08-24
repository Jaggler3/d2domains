import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createApp } from "./app";
import { db, sql } from "./db/client";
import { redis, shutdownQueue } from "./services/queue";
import { loadEnv } from "./config/env";
import { authService } from "./services/auth.service";

const env = loadEnv();

await migrate(db, { migrationsFolder: "./drizzle" });

if (process.env.SEED_USER === "true") {
  try {
    await authService.register("test@example.com", "password123");
    console.log("[hog] seed user created: test@example.com");
  } catch (err: any) {
    if (err.message !== "email already registered") {
      console.error("[hog] failed to seed user:", err);
    }
  }
}

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
