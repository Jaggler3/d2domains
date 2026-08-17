import { Hono } from "hono";
import { domainsController } from "../controllers/domains.controller";
import { ordersController } from "../controllers/orders.controller";
import { dnsController } from "../controllers/dns.controller";
import { settingsController } from "../controllers/settings.controller";
import { requireAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";
import { clientIp } from "../lib/ip";
import { redis } from "../services/queue";
import { loadEnv } from "../config/env";

const env = loadEnv();

const userLimit = (namespace: string, max: number) =>
  rateLimit(redis, {
    windowMs: 60_000,
    max,
    keyFor: (c) => `${namespace}:${c.var.user.id}`,
  });

export const domainsRouter = new Hono();

domainsRouter.post(
  "/search",
  rateLimit(redis, {
    windowMs: 60_000,
    max: env.SEARCH_RATE_LIMIT_PER_MINUTE,
    keyFor: clientIp,
  }),
  (c) => domainsController.search(c),
);

domainsRouter.post(
  "/buy",
  requireAuth,
  userLimit("buy", 20),
  (c) => ordersController.buy(c),
);

domainsRouter.post(
  "/quote",
  requireAuth,
  userLimit("quote", 60),
  (c) => ordersController.quote(c),
);

domainsRouter.get("/", requireAuth, (c) => ordersController.list(c));

domainsRouter.get("/:domainName/dns", requireAuth, userLimit("dns:read", 120), (c) => dnsController.list(c));
domainsRouter.post("/:domainName/dns", requireAuth, userLimit("dns:write", 30), (c) => dnsController.create(c));
domainsRouter.patch("/:domainName/dns/:recordId", requireAuth, userLimit("dns:write", 30), (c) => dnsController.update(c));
domainsRouter.delete("/:domainName/dns/:recordId", requireAuth, userLimit("dns:write", 30), (c) => dnsController.remove(c));

domainsRouter.get("/:domainName/settings", requireAuth, userLimit("settings:read", 60), (c) => settingsController.get(c));
domainsRouter.patch("/:domainName/settings", requireAuth, userLimit("settings:write", 30), (c) => settingsController.patch(c));

export const ordersRouter = new Hono();

ordersRouter.get("/", requireAuth, (c) => ordersController.listOrders(c));
ordersRouter.get("/:id", requireAuth, (c) => ordersController.order(c));
