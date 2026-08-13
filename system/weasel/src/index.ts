import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createApp } from "./app";
import { db, sql } from "./db/client";
import { loadEnv } from "./config/env";

const env = loadEnv();

await migrate(db, { migrationsFolder: "./drizzle" });

const app = createApp(env.INTERNAL_TOKEN);

const server = Bun.serve({
  port: env.WEASEL_PORT,
  fetch: app.fetch,
});

console.log(`weasel (domains) listening on :${env.WEASEL_PORT}`);

async function shutdown() {
  await sql.end();
  server.stop();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
