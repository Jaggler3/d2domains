import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { HttpError } from "./lib/http";
import { requestIdStore } from "./lib/request-id";
import { recordMetric, renderMetrics } from "./lib/metrics";
import { authRouter } from "./web-routers/auth";
import { domainsRouter, ordersRouter } from "./web-routers/domains";
import { billingRouter } from "./web-routers/billing";
import { loadEnv } from "./config/env";

const env = loadEnv();

export function createApp() {
  const app = new Hono();

  app.use("*", async (c, next) => {
    const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
    c.header("x-request-id", requestId);
    const start = Date.now();
    await requestIdStore.run(requestId, async () => {
      await next();
    });
    const path = new URL(c.req.url).pathname;
    recordMetric(path, c.res.status);
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        service: "hog",
        requestId,
        method: c.req.method,
        path,
        status: c.res.status,
        ms: Date.now() - start,
      }),
    );
  });

  app.use("*", secureHeaders());
  app.use("*", cors({ origin: env.CLIENT_ORIGIN, credentials: true }));

  app.get("/healthz", (c) => c.json({ status: "ok" }));
  app.get("/metrics", (c) => c.text(renderMetrics()));

  app.route("/api/v1/auth", authRouter);
  app.route("/api/v1/domains", domainsRouter);
  app.route("/api/v1/orders", ordersRouter);
  app.route("/api/v1/billing", billingRouter);

  app.notFound((c) => c.json({ error: "not found" }, 404));

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json(
        { error: err.message, ...(err.details ? { details: err.details } : {}) },
        err.status as ContentfulStatusCode,
      );
    }
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        service: "hog",
        requestId: requestIdStore.getStore(),
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return c.json({ error: "internal server error" }, 500);
  });

  return app;
}
