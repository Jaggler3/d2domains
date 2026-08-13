import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { logger } from "hono/logger";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { HttpError } from "./lib/http";
import { authRouter } from "./web-routers/auth";
import { domainsRouter } from "./web-routers/domains";
import { loadEnv } from "./config/env";

const env = loadEnv();

export function createApp() {
  const app = new Hono();

  app.use("*", logger());
  app.use("*", secureHeaders());
  app.use("*", cors({ origin: env.CLIENT_ORIGIN, credentials: true }));

  app.get("/healthz", (c) => c.json({ status: "ok" }));

  app.route("/api/v1/auth", authRouter);
  app.route("/api/v1/domains", domainsRouter);

  app.notFound((c) => c.json({ error: "not found" }, 404));

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json(
        { error: err.message, ...(err.details ? { details: err.details } : {}) },
        err.status as ContentfulStatusCode,
      );
    }
    console.error("[hog]", err);
    return c.json({ error: "internal server error" }, 500);
  });

  return app;
}
