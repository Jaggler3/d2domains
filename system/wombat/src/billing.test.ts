import { describe, expect, test } from "bun:test";
import {
  BillingError,
  createBillingService,
  type BillingRepo,
  type Charge,
  type PaymentMethodRow,
} from "./billing";
import { createFakeProcessor, type PaymentProcessor } from "./processor";

function inMemoryRepo() {
  let seq = 0;
  const charges = new Map<string, Charge>();
  const methods = new Map<string, PaymentMethodRow>();
  const ledger: { userId: string; type: string; amountCents: number }[] = [];

  const repo: BillingRepo = {
    async getChargeByOrderId(orderId) {
      return [...charges.values()].find((c) => c.orderId === orderId) ?? null;
    },
    async getChargeById(id) {
      return charges.get(id) ?? null;
    },
    async insertCharge(input) {
      const charge: Charge = {
        id: `c${++seq}`,
        orderId: input.orderId,
        userId: input.userId,
        amountCents: input.amountCents,
        currency: input.currency,
        status: "pending",
        paymentMethodId: input.paymentMethodId,
        providerRef: null,
        failureReason: null,
      };
      charges.set(charge.id, charge);
      return charge;
    },
    async updateCharge(id, patch) {
      const c = charges.get(id);
      if (!c) return;
      charges.set(id, {
        ...c,
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.providerRef !== undefined ? { providerRef: patch.providerRef } : {}),
        ...(patch.failureReason !== undefined ? { failureReason: patch.failureReason } : {}),
      });
    },
    async deleteChargeByOrderId(orderId) {
      const c = [...charges.values()].find((x) => x.orderId === orderId);
      if (c) charges.delete(c.id);
    },
    async getPaymentMethod(id) {
      return methods.get(id) ?? null;
    },
    async getDefaultPaymentMethod(userId) {
      return [...methods.values()].find((m) => m.userId === userId && m.isDefault) ?? null;
    },
    async createDefaultPaymentMethod(userId) {
      const method: PaymentMethodRow = {
        id: `pm${++seq}`,
        userId,
        provider: "fake",
        token: `fake_default_${userId}`,
        brand: "Visa",
        last4: "4242",
        isDefault: true,
      };
      methods.set(method.id, method);
      return method;
    },
    async listPaymentMethods() {
      return [...methods.values()];
    },
    async addPaymentMethod(userId, input) {
      const method: PaymentMethodRow = {
        id: `pm${++seq}`,
        userId,
        provider: "fake",
        token: input.token ?? `fake_${++seq}`,
        brand: input.brand,
        last4: input.last4,
        isDefault: methods.size === 0,
      };
      methods.set(method.id, method);
      return method;
    },
    async setDefaultPaymentMethod(_userId, methodId) {
      for (const m of methods.values()) m.isDefault = m.id === methodId;
    },
    async deletePaymentMethod(userId, methodId) {
      methods.delete(methodId);
    },
    async insertLedgerEntry(entry) {
      ledger.push({ userId: entry.userId, type: entry.type, amountCents: entry.amountCents });
    },
  };

  return { repo, charges, methods, ledger };
}

describe("billing service", () => {
  test("successful charge debits ledger with a charge entry", async () => {
    const { repo, ledger } = inMemoryRepo();
    const billing = createBillingService(repo, createFakeProcessor(0));

    const { charge, reused } = await billing.chargeOrder({
      orderId: "o1",
      userId: "u1",
      amountCents: 1299,
    });

    expect(reused).toBe(false);
    expect(charge.status).toBe("succeeded");
    expect(charge.providerRef).toContain("fake_");
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ userId: "u1", type: "charge", amountCents: 1299 });
  });

  test("declined charge is marked failed with no ledger entry", async () => {
    const { repo, ledger } = inMemoryRepo();
    const billing = createBillingService(repo, createFakeProcessor(2000)); // decline >= $20

    const { charge } = await billing.chargeOrder({
      orderId: "o1",
      userId: "u1",
      amountCents: 2500,
    });

    expect(charge.status).toBe("failed");
    expect(charge.failureReason).toContain("declined");
    expect(ledger).toHaveLength(0);
  });

  test("re-charging the same order is idempotent (reused, no new processor call)", async () => {
    const { repo, ledger } = inMemoryRepo();
    const billing = createBillingService(repo, createFakeProcessor(0));

    await billing.chargeOrder({ orderId: "o1", userId: "u1", amountCents: 1299 });
    const second = await billing.chargeOrder({ orderId: "o1", userId: "u1", amountCents: 1299 });

    expect(second.reused).toBe(true);
    expect(second.charge.status).toBe("succeeded");
    expect(ledger).toHaveLength(1); // only one entry, no double charge
  });

  test("refund flips the charge to refunded and credits the ledger", async () => {
    const { repo, ledger } = inMemoryRepo();
    const billing = createBillingService(repo, createFakeProcessor(0));
    const { charge } = await billing.chargeOrder({ orderId: "o1", userId: "u1", amountCents: 1299 });

    const refunded = await billing.refundCharge({ chargeId: charge.id, userId: "u1" });

    expect(refunded.status).toBe("refunded");
    expect(ledger).toHaveLength(2);
    expect(ledger[1]).toMatchObject({ type: "refund", amountCents: 1299 });
  });

  test("refund of a failed or already-refunded charge is rejected", async () => {
    const { repo } = inMemoryRepo();
    const billing = createBillingService(repo, createFakeProcessor(2000));
    const { charge } = await billing.chargeOrder({ orderId: "o1", userId: "u1", amountCents: 2500 });
    expect(charge.status).toBe("failed");

    await expect(
      billing.refundCharge({ chargeId: charge.id, userId: "u1" }),
    ).rejects.toBeInstanceOf(BillingError);
  });

  test("refund of a missing charge returns 404", async () => {
    const { repo } = inMemoryRepo();
    const billing = createBillingService(repo, createFakeProcessor(0));
    await expect(
      billing.refundCharge({ chargeId: "nope", userId: "u1" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  test("uses a provided payment method when given", async () => {
    const { repo } = inMemoryRepo();
    const billing = createBillingService(repo, createFakeProcessor(0));
    const method = await repo.addPaymentMethod("u1", { brand: "Mastercard", last4: "4444" });

    const { charge } = await billing.chargeOrder({
      orderId: "o1",
      userId: "u1",
      amountCents: 999,
      paymentMethodId: method.id,
    });

    expect(charge.paymentMethodId).toBe(method.id);
  });

  test("rejects a payment method belonging to another user", async () => {
    const { repo } = inMemoryRepo();
    const billing = createBillingService(repo, createFakeProcessor(0));
    const method = await repo.addPaymentMethod("u1", { brand: "Visa", last4: "4242" });

    await expect(
      billing.chargeOrder({
        orderId: "o1",
        userId: "u2",
        amountCents: 999,
        paymentMethodId: method.id,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  test("a declined charge can be retried (failed charges are re-attempted)", async () => {
    const { repo, ledger } = inMemoryRepo();
    let fail = true;
    const processor: PaymentProcessor = {
      charge: async () =>
        fail
          ? { ok: false, failureReason: "card declined" }
          : { ok: true, ref: "fake_retry" },
    };
    const billing = createBillingService(repo, processor);

    const first = await billing.chargeOrder({
      orderId: "o1",
      userId: "u1",
      amountCents: 2500,
    });
    expect(first.reused).toBe(false);
    expect(first.charge.status).toBe("failed");
    expect(ledger).toHaveLength(0);

    fail = false;
    const second = await billing.chargeOrder({
      orderId: "o1",
      userId: "u1",
      amountCents: 2500,
    });
    expect(second.reused).toBe(false);
    expect(second.charge.status).toBe("succeeded");
    expect(second.charge.providerRef).toBe("fake_retry");
    expect(ledger).toHaveLength(1);
  });
});
