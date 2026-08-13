import { Hono } from "hono";
import { domainsController } from "../controllers/domains.controller";
import { ordersController } from "../controllers/orders.controller";
import { requireAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";
import { clientIp } from "../lib/ip";
import { redis } from "../services/queue";
import { loadEnv } from "../config/env";

const env = loadEnv();

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
  rateLimit(redis, {
    windowMs: 60_000,
    max: 20,
    keyFor: (c) => c.var.user.id,
  }),
  (c) => ordersController.buy(c),
);

domainsRouter.get("/", requireAuth, (c) => ordersController.list(c));

export const ordersRouter = new Hono();

ordersRouter.get("/", requireAuth, (c) => ordersController.listOrders(c));
ordersRouter.get("/:id", requireAuth, (c) => ordersController.order(c));
