import { and, eq } from "drizzle-orm";
import { db } from "./client";
import { charges, ledgerEntries, paymentMethods } from "./schema";
import type { BillingRepo, Charge, ChargeStatus, PaymentMethodRow } from "../billing";

function toCharge(row: typeof charges.$inferSelect): Charge {
  return {
    id: row.id,
    orderId: row.orderId,
    userId: row.userId,
    amountCents: row.amountCents,
    currency: row.currency,
    status: row.status as ChargeStatus,
    paymentMethodId: row.paymentMethodId,
    providerRef: row.providerRef,
    failureReason: row.failureReason,
  };
}

function toMethod(row: typeof paymentMethods.$inferSelect): PaymentMethodRow {
  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider,
    token: row.token,
    brand: row.brand,
    last4: row.last4,
    isDefault: row.isDefault,
  };
}

export const billingRepo: BillingRepo = {
  async getChargeByOrderId(orderId) {
    const row = await db.query.charges.findFirst({ where: eq(charges.orderId, orderId) });
    return row ? toCharge(row) : null;
  },
  async getChargeById(id) {
    const row = await db.query.charges.findFirst({ where: eq(charges.id, id) });
    return row ? toCharge(row) : null;
  },
  async insertCharge(input) {
    const [row] = await db
      .insert(charges)
      .values({
        orderId: input.orderId,
        userId: input.userId,
        amountCents: input.amountCents,
        currency: input.currency,
        paymentMethodId: input.paymentMethodId,
      })
      .returning();
    if (!row) throw new Error("failed to insert charge");
    return toCharge(row);
  },
  async updateCharge(id, patch) {
    await db
      .update(charges)
      .set({
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.providerRef !== undefined ? { providerRef: patch.providerRef } : {}),
        ...(patch.failureReason !== undefined ? { failureReason: patch.failureReason } : {}),
        updatedAt: new Date(),
      })
      .where(eq(charges.id, id));
  },
  async deleteChargeByOrderId(orderId) {
    await db.delete(charges).where(eq(charges.orderId, orderId));
  },
  async getPaymentMethod(id) {
    const row = await db.query.paymentMethods.findFirst({ where: eq(paymentMethods.id, id) });
    return row ? toMethod(row) : null;
  },
  async getDefaultPaymentMethod(userId) {
    const row = await db.query.paymentMethods.findFirst({
      where: and(eq(paymentMethods.userId, userId), eq(paymentMethods.isDefault, true)),
    });
    return row ? toMethod(row) : null;
  },
  async createDefaultPaymentMethod(userId) {
    const token = `fake_default_${userId}`;
    const existing = await db.query.paymentMethods.findFirst({
      where: eq(paymentMethods.token, token),
    });
    if (existing) return toMethod(existing);
    const [row] = await db
      .insert(paymentMethods)
      .values({
        userId,
        provider: "fake",
        token,
        brand: "Visa",
        last4: "4242",
        isDefault: true,
      })
      .returning();
    if (!row) throw new Error("failed to create default payment method");
    return toMethod(row);
  },
  async listPaymentMethods(userId) {
    const rows = await db.query.paymentMethods.findMany({
      where: eq(paymentMethods.userId, userId),
      orderBy: (m, { desc }) => [desc(m.isDefault), desc(m.createdAt)],
    });
    return rows.map(toMethod);
  },
  async addPaymentMethod(userId, input) {
    const count = await db.query.paymentMethods.findMany({
      where: eq(paymentMethods.userId, userId),
      columns: { id: true },
      limit: 1,
    });
    const [row] = await db
      .insert(paymentMethods)
      .values({
        userId,
        provider: "fake",
        token: input.token || `fake_${crypto.randomUUID()}`,
        brand: input.brand,
        last4: input.last4,
        expMonth: input.expMonth ?? null,
        expYear: input.expYear ?? null,
        isDefault: count.length === 0,
      })
      .returning();
    if (!row) throw new Error("failed to add payment method");
    return toMethod(row);
  },
  async setDefaultPaymentMethod(userId, methodId) {
    await db.transaction(async (tx) => {
      await tx
        .update(paymentMethods)
        .set({ isDefault: false })
        .where(eq(paymentMethods.userId, userId));
      await tx
        .update(paymentMethods)
        .set({ isDefault: true })
        .where(and(eq(paymentMethods.id, methodId), eq(paymentMethods.userId, userId)));
    });
  },
  async deletePaymentMethod(userId, methodId) {
    await db.transaction(async (tx) => {
      const row = await tx.query.paymentMethods.findFirst({
        where: and(eq(paymentMethods.id, methodId), eq(paymentMethods.userId, userId)),
      });
      if (!row) return;
      await tx.delete(paymentMethods).where(eq(paymentMethods.id, methodId));
      if (row.isDefault) {
        const [next] = await tx.query.paymentMethods.findMany({
          where: eq(paymentMethods.userId, userId),
          orderBy: (m, { asc }) => [asc(m.createdAt)],
          limit: 1,
        });
        if (next) {
          await tx
            .update(paymentMethods)
            .set({ isDefault: true })
            .where(eq(paymentMethods.id, next.id));
        }
      }
    });
  },
  async insertLedgerEntry(entry) {
    await db.insert(ledgerEntries).values({
      userId: entry.userId,
      type: entry.type,
      amountCents: entry.amountCents,
      currency: entry.currency,
      refId: entry.refId,
      description: entry.description,
    });
  },
};
