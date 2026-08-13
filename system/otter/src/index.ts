import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createApp } from "./app";
import { db, sql } from "./db/client";
import { redis, shutdownOtter, startDnsSyncWorker } from "./services/dns-sync";
import { loadEnv } from "./config/env";

const env = loadEnv();

await migrate(db, { migrationsFolder: "./drizzle" });

try {
  await redis.ping();
  console.log("[otter] redis connected");
} catch (err) {
  console.error("[otter] redis unavailable, dns-sync degraded:", err);
}

const app = createApp();
const server = Bun.serve({
  port: env.OTTER_PORT,
  fetch: app.fetch,
});

const worker = startDnsSyncWorker();
console.log(`otter (dns) listening on :${env.OTTER_PORT}`);

async function shutdown() {
  await worker.close();
  await shutdownOtter();
  redis.disconnect();
  await sql.end();
  server.stop();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
