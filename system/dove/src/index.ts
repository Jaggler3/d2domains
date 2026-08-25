import { Hono } from "hono";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { loadEnv } from "./config/env";
import { requireInternalToken } from "./middleware/internal-auth";
import { createStalwartClient } from "./adapters/stalwart";
import { createWeaselClient } from "./adapters/weasel";
import { createOtterClient } from "./adapters/otter";
import {
  createProvisioningService,
  type ProvisioningService,
} from "./services/provisioning.service";
import { bootstrapStalwart } from "./services/bootstrap.service";
import { provisioningRouter, mailboxRouter } from "./web-routers/provisioning";
import { db, sql } from "./db/client";

const env = loadEnv();

await migrate(db, { migrationsFolder: "./drizzle" });
console.log("[dove] migrations applied");
const app = new Hono<{ Variables: { provisioningService: ProvisioningService } }>();

app.onError((err, c) => {
  const status = typeof err === "object" && err && "status" in err
    ? Number((err as { status?: unknown }).status) || 500
    : 500;
  console.error(
    `[dove] ${c.req.method} ${c.req.path} failed (${status}):`,
    err instanceof Error ? err.stack : err,
  );
  return c.json({ error: err instanceof Error ? err.message : "internal error" }, status as 500);
});

app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  console.log(
    `[dove] ${c.req.method} ${c.req.path} -> ${c.res.status} (${Date.now() - start}ms)`,
  );
});

const stalwart = createStalwartClient({
  url: env.STALWART_URL,
  adminUser: env.STALWART_ADMIN_USER,
  adminPassword: env.STALWART_ADMIN_PASSWORD,
  apiKey: env.STALWART_API_KEY,
});

const weasel = createWeaselClient({
  baseUrl: env.WEASEL_URL,
  internalToken: env.INTERNAL_TOKEN,
});

const otter = createOtterClient({
  baseUrl: env.OTTER_URL,
  internalToken: env.INTERNAL_TOKEN,
});

const provisioningService = createProvisioningService({
  stalwart,
  weasel,
  otter,
  mailHost: env.MAIL_HOST,
  mxPriority: env.MAIL_MX_PRIORITY,
});

await bootstrapStalwart({
  stalwart,
  serverHostname: env.MAIL_HOST,
  defaultDomain: env.STALWART_BOOTSTRAP_DOMAIN,
  directory: {
    host: env.DOVE_PGHOST,
    port: env.DOVE_PGPORT,
    database: env.DOVE_PGDATABASE,
    username: env.DOVE_PGUSER,
    password: env.DOVE_PGPASSWORD,
  },
});

// We inject the service into the routers via a simple middleware so the
// routers stay declarative and testable.

app.use("*", async (c, next) => {
  c.set("provisioningService", provisioningService);
  await next();
});

app.use("/internal/*", requireInternalToken(env.INTERNAL_TOKEN));
app.route("/internal", provisioningRouter);
app.route("/internal", mailboxRouter);

const server = Bun.serve({
  port: env.DOVE_PORT,
  fetch: app.fetch,
});

console.log(`dove (mail provisioning) listening on :${server.port}`);

async function shutdown() {
  await sql.end();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
