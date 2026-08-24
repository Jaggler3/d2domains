import type { Context } from "hono";
import { z } from "zod";
import Stripe from "stripe";
import { BillingError, createBillingService } from "../billing";
import { billingRepo } from "../db/repo";
import { createFakeProcessor, createStripeProcessor } from "../processor";
import { HttpError } from "../lib/http";
import { loadEnv } from "../config/env";

const env = loadEnv();

const processor = env.STRIPE_SECRET_KEY
  ? createStripeProcessor(env.STRIPE_SECRET_KEY)
  : createFakeProcessor(env.FAKE_PAYMENT_FAIL_MIN_CENTS);
const billing = createBillingService(billingRepo, processor);

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

const stripe = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null;

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
    let methodInput = parsed.data;
    if (stripe && parsed.data.token?.startsWith("pm_")) {
      const paymentMethod = await stripe.paymentMethods.retrieve(parsed.data.token);
      const card = paymentMethod.card;
      if (!card) throw new HttpError("stripe payment method missing card", 422);
      methodInput = {
        ...parsed.data,
        brand: card.brand ?? parsed.data.brand,
        last4: card.last4 ?? parsed.data.last4,
        token: paymentMethod.id,
      };
    }
    const method = await billingRepo.addPaymentMethod(methodInput.userId, methodInput);
    return c.json({ paymentMethod: method }, 201);
  },

  async createSetupIntent(c: Context) {
    if (!stripe) throw new HttpError("stripe is not configured", 503);
    const intent = await stripe.setupIntents.create({
      payment_method_types: ["card"],
    });
    return c.json({ clientSecret: intent.client_secret });
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
