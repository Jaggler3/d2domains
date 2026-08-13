import { Hono } from "hono";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { HttpError } from "./lib/http";
import { otterRouter } from "./web-routers/otter";

export function createApp() {
  const app = new Hono();

  app.use("*", logger());
  app.use("*", secureHeaders());

  app.get("/healthz", (c) => c.json({ status: "ok" }));

  app.route("/v1", otterRouter);

  app.notFound((c) => c.json({ error: "not found" }, 404));

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: err.message }, err.status as ContentfulStatusCode);
    }
    console.error("[otter]", err);
    return c.json({ error: "internal server error" }, 500);
  });

  return app;
}
