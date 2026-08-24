import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { HttpError } from "./lib/http";
import { BillingError } from "./billing";
import { loadEnv } from "./config/env";
import { requireInternalToken } from "./middleware/internal-auth";
import { wombatRouter } from "./web-routers/wombat";
import { billingRepo } from "./db/repo";

async function patchWeaselOrder(
  weaselUrl: string,
  internalToken: string,
  orderId: string,
  patch: { status: "pending" | "purchased" | "failed"; error?: string | null },
) {
  const res = await fetch(`${weaselUrl}/internal/orders/${encodeURIComponent(orderId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-internal-token": internalToken,
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new HttpError(data?.error ?? "failed to update order", res.status);
  }
}

export function createApp(internalToken: string) {
  const app = new Hono();
  const env = loadEnv();

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
  app.post("/webhook", async (c) => {
    const payload = await c.req.json().catch(() => null);

    let eventType: string | undefined;
    let orderId: string | undefined;
    let chargeId: string | undefined;
    let providerRef: string | null | undefined;
    let failureReason: string | null | undefined;

    if (payload && typeof payload === "object" && "type" in payload) {
      eventType = String((payload as { type: unknown }).type);
    }

    if (eventType && eventType.startsWith("payment_intent.")) {
      const intent = payload as {
        id?: string;
        status?: string;
        metadata?: { orderId?: string };
        latest_charge?: string | null;
      } | null;
      orderId = intent?.metadata?.orderId;
      chargeId = intent?.latest_charge ?? intent?.id;
      providerRef = intent?.id;
      failureReason = intent?.status && intent.status !== "succeeded"
        ? `payment intent ${intent.status}`
        : null;
    } else if (payload && typeof payload === "object" && "orderId" in payload) {
      const body = payload as {
        orderId?: string;
        chargeId?: string;
        providerRef?: string | null;
        status?: "pending" | "succeeded" | "failed";
        failureReason?: string | null;
      };
      orderId = body.orderId;
      chargeId = body.chargeId;
      providerRef = body.providerRef;
      failureReason = body.failureReason;
      eventType = `charge.${body.status ?? "succeeded"}`;
    }

    if (!orderId) return c.json({ error: "missing orderId" }, 422);

    const charge = await billingRepo.getChargeByOrderId(orderId);
    if (charge) {
      await billingRepo.updateCharge(charge.id, {
        status: eventType?.endsWith("failed") ? "failed" : "succeeded",
        providerRef: providerRef ?? charge.providerRef,
        failureReason: eventType?.endsWith("failed")
          ? (failureReason ?? charge.failureReason ?? "card declined")
          : null,
      });
      chargeId = charge.id;
    }

    await patchWeaselOrder(
      env.WEASEL_URL,
      env.INTERNAL_TOKEN,
      orderId,
      eventType?.endsWith("failed")
        ? { status: "failed", error: failureReason ?? "card declined" }
        : { status: "purchased", error: null },
    );

    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      service: "wombat",
      event: eventType ?? "webhook",
      chargeId,
      orderId,
    }));
    return c.json({ received: true });
  });

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
