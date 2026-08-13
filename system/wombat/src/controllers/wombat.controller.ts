import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { charges } from "../db/schema";
import { HttpError } from "../lib/http";

const chargeSchema = z.object({
  orderId: z.string().min(1),
  userId: z.string().min(1),
  amountCents: z.number().int().positive(),
  currency: z.string().min(3).max(3).default("usd"),
});

export const wombatController = {
  async createCharge(c: Context) {
    const body = await c.req.json().catch(() => null);
    const parsed = chargeSchema.safeParse(body);
    if (!parsed.success) throw new HttpError("invalid charge", 422);

    const existing = await db.query.charges.findFirst({
      where: eq(charges.orderId, parsed.data.orderId),
    });
    if (existing) return c.json({ charge: existing, reused: true });

    const [charge] = await db
      .insert(charges)
      .values({
        orderId: parsed.data.orderId,
        userId: parsed.data.userId,
        amountCents: parsed.data.amountCents,
        currency: parsed.data.currency,
        status: "succeeded",
      })
      .returning();
    if (!charge) throw new HttpError("failed to create charge", 500);
    return c.json({ charge, reused: false }, 201);
  },
};
