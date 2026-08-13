import { Redis } from "ioredis";
import { createApp } from "./app";
import { loadEnv } from "./config/env";

const env = loadEnv();

const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

try {
  await redis.ping();
  console.log("[heron] redis connected");
} catch (err) {
  console.error("[heron] redis unavailable, rate limiting disabled:", err);
}

const app = createApp(redis, env.INTERNAL_TOKEN);

const server = Bun.serve({
  port: env.HERON_PORT,
  fetch: app.fetch,
});

console.log(`heron (registry gateway) listening on :${env.HERON_PORT}`);
console.log(`  upstream: ${env.NAME_COM_BASE}`);

async function shutdown() {
  redis.disconnect();
  server.stop();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
