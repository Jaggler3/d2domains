import type { Context } from "hono";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { domains, orders } from "../db/schema";
import { HttpError } from "../lib/http";

const addonSchema = z.object({
  type: z.string().min(1),
  plan: z.string().min(1),
  mailboxes: z.number().int().min(1).default(1),
  years: z.number().int().min(1).max(10).default(1),
  priceCents: z.number().int().positive(),
});

const createOrderSchema = z.object({
  userId: z.string().min(1),
  domainName: z.string().min(1),
  years: z.number().int().min(1).max(10).default(1),
  purchaseType: z.enum(["registration", "premium"]).default("registration"),
  priceCents: z.number().int().positive(),
  totalCents: z.number().int().positive().optional(),
  paymentMethodId: z.string().nullable().optional(),
  addons: z.array(addonSchema).optional().default([]),
  idempotencyKey: z.string().min(1),
});

const patchOrderSchema = z.object({
  status: z.enum(["pending", "purchased", "failed"]).optional(),
  error: z.string().nullable().optional(),
  totalCents: z.number().int().positive().optional(),
  paymentMethodId: z.string().nullable().optional(),
  addons: z.array(addonSchema).optional(),
  years: z.number().int().min(1).max(10).optional(),
});

const createDomainSchema = z.object({
  userId: z.string().min(1),
  domainName: z.string().min(1),
  years: z.number().int().min(1).max(10).default(1),
  expiresAt: z.string().datetime(),
  orderId: z.string().min(1),
});

function requiredParam(c: Context, name: string): string {
  const value = c.req.param(name);
  if (!value) throw new HttpError(`${name} is required`, 422);
  return value;
}

export const weaselController = {
  async createOrder(c: Context) {
    const body = await c.req.json().catch(() => null);
    const parsed = createOrderSchema.safeParse(body);
    if (!parsed.success) throw new HttpError("invalid order", 422);

    const existing = await db.query.orders.findFirst({
      where: eq(orders.idempotencyKey, parsed.data.idempotencyKey),
    });
    if (existing) return c.json({ order: existing, reused: true });

    const [order] = await db
      .insert(orders)
      .values({
        userId: parsed.data.userId,
        domainName: parsed.data.domainName,
        years: parsed.data.years,
        purchaseType: parsed.data.purchaseType,
        priceCents: parsed.data.priceCents,
        totalCents: parsed.data.totalCents ?? parsed.data.priceCents,
        paymentMethodId: parsed.data.paymentMethodId ?? null,
        addons: parsed.data.addons,
        idempotencyKey: parsed.data.idempotencyKey,
      })
      .returning();
    if (!order) throw new HttpError("failed to create order", 500);
    return c.json({ order, reused: false }, 201);
  },

  async patchOrder(c: Context) {
    const id = requiredParam(c, "id");
    const body = await c.req.json().catch(() => null);
    const parsed = patchOrderSchema.safeParse(body);
    if (!parsed.success) throw new HttpError("invalid update", 422);

    const [order] = await db
      .update(orders)
      .set({
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
        ...(parsed.data.error !== undefined ? { error: parsed.data.error } : {}),
        ...(parsed.data.totalCents !== undefined
          ? { totalCents: parsed.data.totalCents }
          : {}),
        ...(parsed.data.paymentMethodId !== undefined
          ? { paymentMethodId: parsed.data.paymentMethodId }
          : {}),
        ...(parsed.data.addons !== undefined ? { addons: parsed.data.addons } : {}),
        ...(parsed.data.years !== undefined ? { years: parsed.data.years } : {}),
        updatedAt: new Date(),
      })
      .where(eq(orders.id, id))
      .returning();
    if (!order) throw new HttpError("order not found", 404);
    return c.json({ order });
  },

  async getOrder(c: Context) {
    const order = await db.query.orders.findFirst({
      where: eq(orders.id, requiredParam(c, "id")),
    });
    if (!order) throw new HttpError("order not found", 404);
    return c.json({ order });
  },

  async listOrders(c: Context) {
    const userId = c.req.query("userId");
    if (!userId) throw new HttpError("userId is required", 422);
    const result = await db.query.orders.findMany({
      where: eq(orders.userId, userId),
      orderBy: (o, { desc }) => [desc(o.createdAt)],
    });
    return c.json({ orders: result });
  },

  async createDomain(c: Context) {
    const body = await c.req.json().catch(() => null);
    const parsed = createDomainSchema.safeParse(body);
    if (!parsed.success) throw new HttpError("invalid domain", 422);

    const existing = await db.query.domains.findFirst({
      where: eq(domains.domainName, parsed.data.domainName),
    });
    if (existing) throw new HttpError("domain already exists", 409);

    const [domain] = await db
      .insert(domains)
      .values({
        userId: parsed.data.userId,
        domainName: parsed.data.domainName,
        years: parsed.data.years,
        expiresAt: new Date(parsed.data.expiresAt),
        orderId: parsed.data.orderId,
      })
      .returning();
    if (!domain) throw new HttpError("failed to create domain", 500);
    return c.json({ domain }, 201);
  },

  async listDomains(c: Context) {
    const userId = c.req.query("userId");
    if (!userId) throw new HttpError("userId is required", 422);
    const result = await db.query.domains.findMany({
      where: eq(domains.userId, userId),
      orderBy: (d, { desc }) => [desc(d.purchasedAt)],
    });
    return c.json({ domains: result });
  },

  async getDomain(c: Context) {
    const userId = c.req.query("userId");
    const conditions = [eq(domains.domainName, requiredParam(c, "domainName"))];
    if (userId) conditions.push(eq(domains.userId, userId));
    const domain = await db.query.domains.findFirst({
      where: and(...conditions),
    });
    if (!domain) throw new HttpError("domain not found", 404);
    return c.json({ domain });
  },
};
