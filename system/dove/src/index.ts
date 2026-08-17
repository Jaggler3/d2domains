import { Hono } from "hono";
import { loadEnv } from "./config/env";
import { requireInternalToken } from "./middleware/internal-auth";
import { createStalwartClient } from "./adapters/stalwart";
import { createWeaselClient } from "./adapters/weasel";
import { createOtterClient } from "./adapters/otter";
import { createProvisioningService } from "./services/provisioning.service";
import { provisioningRouter, mailboxRouter } from "./web-routers/provisioning";

const env = loadEnv();
const app = new Hono();

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
});

// We inject the service into the routers via a simple wrapper or just use the closure
// since Hono context bindings usually come from env/variables.
// For simplicity in Bun/Hono, we can just call the service directly in the routers
// if we modify the routers to accept the service, or just use a middleware to attach it.

app.use("*", async (c, next) => {
  c.set("provisioningService", provisioningService);
  await next();
});

app.route("/internal", requireInternalToken(env.INTERNAL_TOKEN), provisioningRouter);
app.route("/internal", requireInternalToken(env.INTERNAL_TOKEN), mailboxRouter);

export default {
  port: env.DOVE_PORT,
  fetch: app.fetch,
};
