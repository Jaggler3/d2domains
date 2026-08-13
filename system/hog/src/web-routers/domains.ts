import { Hono } from "hono";
import { domainsController } from "../controllers/domains.controller";
import { requireAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";
import { redis } from "../services/queue";
import { loadEnv } from "../config/env";

const env = loadEnv();

export const domainsRouter = new Hono();

domainsRouter.post(
  "/search",
  requireAuth,
  rateLimit(redis, {
    windowMs: 60_000,
    max: env.SEARCH_RATE_LIMIT_PER_MINUTE,
    keyFor: (c) => c.var.user.id,
  }),
  (c) => domainsController.search(c),
);
