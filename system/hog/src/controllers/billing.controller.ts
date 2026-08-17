import type { Context } from "hono";
import { z } from "zod";
import { createWombatClient } from "../adapters/wombat";
import { HttpError } from "../lib/http";
import type { AuthVariables } from "../middleware/auth";
import { loadEnv } from "../config/env";

const env = loadEnv();

const wombat = createWombatClient({
  baseUrl: env.WOMBAT_URL,
  internalToken: env.INTERNAL_TOKEN,
});

const addMethodSchema = z.object({
  brand: z.string().min(1).max(32),
  last4: z.string().min(4).max(4),
  token: z.string().min(1).max(200).optional(),
  expMonth: z.number().int().min(1).max(12).nullable().optional(),
  expYear: z.number().int().min(2000).max(2100).nullable().optional(),
});

export const billingController = {
  async listMethods(c: Context<{ Variables: AuthVariables }>) {
    const { paymentMethods } = await wombat.listPaymentMethods(c.var.user.id);
    return c.json({ paymentMethods });
  },

  async addMethod(c: Context<{ Variables: AuthVariables }>) {
    const body = await c.req.json().catch(() => null);
    const parsed = addMethodSchema.safeParse(body);
    if (!parsed.success) throw new HttpError("invalid payment method", 422);
    const { paymentMethod } = await wombat.addPaymentMethod(
      c.var.user.id,
      parsed.data,
    );
    return c.json({ paymentMethod }, 201);
  },

  async setDefaultMethod(c: Context<{ Variables: AuthVariables }>) {
    const methodId = c.req.param("id");
    if (!methodId) throw new HttpError("method id is required", 422);
    const { paymentMethods } = await wombat.setDefaultPaymentMethod(
      c.var.user.id,
      methodId,
    );
    return c.json({ paymentMethods });
  },

  async deleteMethod(c: Context<{ Variables: AuthVariables }>) {
    const methodId = c.req.param("id");
    if (!methodId) throw new HttpError("method id is required", 422);
    await wombat.deletePaymentMethod(c.var.user.id, methodId);
    return c.body(null, 204);
  },
};