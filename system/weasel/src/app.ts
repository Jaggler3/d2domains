import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { HttpError } from "./lib/http";
import { requireInternalToken } from "./middleware/internal-auth";
import { weaselRouter } from "./web-routers/weasel";

export function createApp(internalToken: string) {
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
        service: "weasel",
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

  app.use("/internal/*", requireInternalToken(internalToken));
  app.route("/internal", weaselRouter);

  app.notFound((c) => c.json({ error: "not found" }, 404));

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: err.message }, err.status as ContentfulStatusCode);
    }
    console.error("[weasel]", err);
    return c.json({ error: "internal server error" }, 500);
  });

  return app;
}
