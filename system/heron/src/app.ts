import { Hono } from "hono";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createRegistryRouter } from "./web-routers/registry";
import { HeronError } from "./controllers/registry.controller";
import { RegistryError } from "./adapters/namecom";
import type { Redis } from "ioredis";

export function createApp(redis: Redis) {
  const app = new Hono();

  app.use("*", logger());
  app.use("*", secureHeaders());

  app.get("/healthz", (c) => c.json({ status: "ok" }));

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
