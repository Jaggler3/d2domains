import type { Context } from "hono";
import { z } from "zod";
import { BillingError, createBillingService } from "../billing";
import { billingRepo } from "../db/repo";
import { createFakeProcessor } from "../processor";
import { HttpError } from "../lib/http";
import { loadEnv } from "../config/env";

const env = loadEnv();

const billing = createBillingService(billingRepo, createFakeProcessor(env.FAKE_PAYMENT_FAIL_MIN_CENTS));

const chargeSchema = z.object({
  orderId: z.string().min(1),
  userId: z.string().min(1),
  amountCents: z.number().int().positive(),
  currency: z.string().min(3).max(3).default("usd"),
  paymentMethodId: z.string().nullable().optional(),
});

const refundSchema = z.object({
  userId: z.string().min(1),
});

const methodSchema = z.object({
  userId: z.string().min(1),
  brand: z.string().min(1).max(32),
  last4: z.string().min(4).max(4),
  token: z.string().min(1).max(200).optional(),
  expMonth: z.number().int().min(1).max(12).nullable().optional(),
  expYear: z.number().int().min(2000).max(2100).nullable().optional(),
});

function userIdOf(c: Context): string {
  const userId = c.req.query("userId");
  if (!userId) throw new HttpError("userId is required", 422);
  return userId;
}

export const wombatController = {
  async createCharge(c: Context) {
    const body = await c.req.json().catch(() => null);
    const parsed = chargeSchema.safeParse(body);
    if (!parsed.success) throw new HttpError("invalid charge", 422);
    const result = await billing.chargeOrder(parsed.data);
    return c.json(result, result.reused ? 200 : 201);
  },

  async refundCharge(c: Context) {
    const chargeId = c.req.param("id");
    if (!chargeId) throw new HttpError("charge id is required", 422);
    const body = await c.req.json().catch(() => null);
    const parsed = refundSchema.safeParse(body);
    if (!parsed.success) throw new HttpError("invalid refund", 422);
    const charge = await billing.refundCharge({ chargeId, userId: parsed.data.userId });
    return c.json({ charge });
  },

  async createPaymentMethod(c: Context) {
    const body = await c.req.json().catch(() => null);
    const parsed = methodSchema.safeParse(body);
    if (!parsed.success) throw new HttpError("invalid payment method", 422);
    const method = await billingRepo.addPaymentMethod(parsed.data.userId, parsed.data);
    return c.json({ paymentMethod: method }, 201);
  },

  async listPaymentMethods(c: Context) {
    const methods = await billingRepo.listPaymentMethods(userIdOf(c));
    return c.json({ paymentMethods: methods });
  },

  async setDefaultPaymentMethod(c: Context) {
    const methodId = c.req.param("id");
    if (!methodId) throw new HttpError("method id is required", 422);
    await billingRepo.setDefaultPaymentMethod(userIdOf(c), methodId);
    const methods = await billingRepo.listPaymentMethods(userIdOf(c));
    return c.json({ paymentMethods: methods });
  },

  async deletePaymentMethod(c: Context) {
    const methodId = c.req.param("id");
    if (!methodId) throw new HttpError("method id is required", 422);
    await billingRepo.deletePaymentMethod(userIdOf(c), methodId);
    return c.body(null, 204);
  },
};
