import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createRegistryRouter } from "./web-routers/registry";
import { requireInternalToken } from "./middleware/internal-auth";
import { HeronError } from "./controllers/registry.controller";
import { RegistryError } from "./adapters/namecom";
import type { Redis } from "ioredis";

export function createApp(redis: Redis, internalToken: string) {
  const app = new Hono();

  app.use("*", async (c, next) => {
    const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
    c.header("x-request-id", requestId);
    const start = Date.now();
    await next();
    const path = new URL(c.req.url).pathname;
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        service: "heron",
        requestId,
        method: c.req.method,
        path,
        status: c.res.status,
        ms: Date.now() - start,
      }),
    );
  });
  app.use("*", secureHeaders());

  app.get("/healthz", (c) => c.json({ status: "ok" }));

  app.use("/v1/*", requireInternalToken(internalToken));
  app.route("/v1", createRegistryRouter(redis));

  app.notFound((c) => c.json({ error: "not found" }, 404));

  app.onError((err, c) => {
    if (err instanceof HeronError) {
      return c.json({ error: err.message }, err.status as ContentfulStatusCode);
    }
    if (err instanceof RegistryError) {
      const status = err.status >= 400 && err.status < 600 ? err.status : 502;
      return c.json({ error: err.message }, status as ContentfulStatusCode);
    }
    console.error("[heron]", err);
    return c.json({ error: "internal server error" }, 500);
  });

  return app;
}
