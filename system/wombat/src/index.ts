import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createApp } from "./app";
import { db, sql } from "./db/client";
import { loadEnv } from "./config/env";

const env = loadEnv();

await migrate(db, { migrationsFolder: "./drizzle" });

const app = createApp();

const server = Bun.serve({
  port: env.WOMBAT_PORT,
  fetch: app.fetch,
});

console.log(`wombat (billing) listening on :${env.WOMBAT_PORT}`);

async function shutdown() {
  await sql.end();
  server.stop();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
