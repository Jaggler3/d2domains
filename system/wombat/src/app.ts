import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { HttpError } from "./lib/http";
import { BillingError } from "./billing";
import { requireInternalToken } from "./middleware/internal-auth";
import { wombatRouter } from "./web-routers/wombat";

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
        service: "wombat",
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
  app.route("/internal", wombatRouter);

  app.notFound((c) => c.json({ error: "not found" }, 404));

  app.onError((err, c) => {
    if (err instanceof HttpError || err instanceof BillingError) {
      return c.json({ error: err.message }, err.status as ContentfulStatusCode);
    }
    console.error("[wombat]", err);
    return c.json({ error: "internal server error" }, 500);
  });

  return app;
}
