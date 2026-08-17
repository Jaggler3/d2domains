import type { PaymentProcessor } from "./processor";

export type ChargeStatus = "pending" | "succeeded" | "failed" | "refunded";

export interface Charge {
  id: string;
  orderId: string;
  userId: string;
  amountCents: number;
  currency: string;
  status: ChargeStatus;
  paymentMethodId: string | null;
  providerRef: string | null;
  failureReason: string | null;
}

export interface PaymentMethodRow {
  id: string;
  userId: string;
  provider: string;
  token: string;
  brand: string;
  last4: string;
  isDefault: boolean;
}

export interface BillingRepo {
  getChargeByOrderId(orderId: string): Promise<Charge | null>;
  getChargeById(id: string): Promise<Charge | null>;
  insertCharge(input: {
    orderId: string;
    userId: string;
    amountCents: number;
    currency: string;
    paymentMethodId: string;
  }): Promise<Charge>;
  updateCharge(id: string, patch: {
    status?: ChargeStatus;
    providerRef?: string | null;
    failureReason?: string | null;
  }): Promise<void>;
  deleteChargeByOrderId(orderId: string): Promise<void>;
  getPaymentMethod(id: string): Promise<PaymentMethodRow | null>;
  getDefaultPaymentMethod(userId: string): Promise<PaymentMethodRow | null>;
  createDefaultPaymentMethod(userId: string): Promise<PaymentMethodRow>;
  listPaymentMethods(userId: string): Promise<PaymentMethodRow[]>;
  addPaymentMethod(userId: string, input: {
    brand: string;
    last4: string;
    token?: string;
    expMonth?: number | null;
    expYear?: number | null;
  }): Promise<PaymentMethodRow>;
  setDefaultPaymentMethod(userId: string, methodId: string): Promise<void>;
  deletePaymentMethod(userId: string, methodId: string): Promise<void>;
  insertLedgerEntry(entry: {
    userId: string;
    type: "charge" | "refund";
    amountCents: number;
    currency: string;
    refId: string;
    description?: string;
  }): Promise<void>;
}

export class BillingError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "BillingError";
  }
}

export function createBillingService(
  repo: BillingRepo,
  processor: PaymentProcessor,
) {
  async function resolvePaymentMethod(
    userId: string,
    paymentMethodId?: string | null,
  ): Promise<PaymentMethodRow> {
    if (paymentMethodId) {
      const method = await repo.getPaymentMethod(paymentMethodId);
      if (!method || method.userId !== userId) {
        throw new BillingError("payment method not found", 404);
      }
      return method;
    }
    const existing = await repo.getDefaultPaymentMethod(userId);
    return existing ?? repo.createDefaultPaymentMethod(userId);
  }

  return {
    async chargeOrder(input: {
      orderId: string;
      userId: string;
      amountCents: number;
      currency?: string;
      paymentMethodId?: string | null;
    }): Promise<{ charge: Charge; reused: boolean }> {
      const existing = await repo.getChargeByOrderId(input.orderId);
      if (existing && existing.status !== "failed") {
        return { charge: existing, reused: true };
      }
      // A failed charge can be retried (e.g. with a different card): drop the
      // old attempt so a fresh one is made.
      if (existing) await repo.deleteChargeByOrderId(input.orderId);

      const method = await resolvePaymentMethod(input.userId, input.paymentMethodId);
      const charge = await repo.insertCharge({
        orderId: input.orderId,
        userId: input.userId,
        amountCents: input.amountCents,
        currency: input.currency ?? "usd",
        paymentMethodId: method.id,
      });

      const result = await processor.charge({
        amountCents: input.amountCents,
        card: { token: method.token, brand: method.brand, last4: method.last4 },
      });

      if (result.ok) {
        await repo.updateCharge(charge.id, { status: "succeeded", providerRef: result.ref ?? null });
        await repo.insertLedgerEntry({
          userId: input.userId,
          type: "charge",
          amountCents: input.amountCents,
          currency: charge.currency,
          refId: charge.id,
          description: `purchase charge ${charge.id}`,
        });
        return { charge: { ...charge, status: "succeeded", providerRef: result.ref ?? null }, reused: false };
      }

      await repo.updateCharge(charge.id, {
        status: "failed",
        failureReason: result.failureReason ?? "card declined",
      });
      return {
        charge: { ...charge, status: "failed", failureReason: result.failureReason ?? "card declined" },
        reused: false,
      };
    },

    async refundCharge(input: { chargeId: string; userId: string }): Promise<Charge> {
      const charge = await repo.getChargeById(input.chargeId);
      if (!charge || charge.userId !== input.userId) {
        throw new BillingError("charge not found", 404);
      }
      if (charge.status !== "succeeded") {
        throw new BillingError("charge is not refundable", 409);
      }
      await repo.updateCharge(charge.id, { status: "refunded" });
      await repo.insertLedgerEntry({
        userId: input.userId,
        type: "refund",
        amountCents: charge.amountCents,
        currency: charge.currency,
        refId: charge.id,
        description: `refund of charge ${charge.id}`,
      });
      return { ...charge, status: "refunded" };
    },
  };
}
