import { createWombatClient } from "../adapters/wombat";
import { createWeaselClient } from "../adapters/weasel";
import { HttpError } from "../lib/http";
import { assertDomainOwnership } from "./ownership";
import {
  EMAIL_PLANS,
  addonTotalCents,
  buildAddons,
  type AddonInput,
} from "./catalog";
import { enqueueEmailJob, enqueuePurchase } from "./queue";
import { loadEnv } from "../config/env";

const env = loadEnv();

const weasel = createWeaselClient({ baseUrl: env.WEASEL_URL, internalToken: env.INTERNAL_TOKEN });
const wombat = createWombatClient({ baseUrl: env.WOMBAT_URL, internalToken: env.INTERNAL_TOKEN });

export interface AddEmailInput {
  plan?: string;
  mailboxes?: number;
}

async function resolvePaymentMethod(userId: string, requested?: string | null): Promise<string> {
  if (requested) return requested;
  const { paymentMethods } = await wombat.listPaymentMethods(userId);
  const fallback = paymentMethods.find((m) => m.isDefault) ?? paymentMethods[0];
  if (!fallback) {
    throw new HttpError("add a payment method before adding email", 422);
  }
  return fallback.id;
}

/**
 * Adds an email plan to an already-purchased domain by creating an
 * add-on-only order (charged immediately, full annual price), then
 * enqueuing provisioning. Idempotent per user+domain.
 */
export async function addEmail(
  userId: string,
  domainName: string,
  input: AddEmailInput & { paymentMethodId?: string | null },
) {
  await assertDomainOwnership(userId, domainName);

  const { orders } = await weasel.listOrders(userId);
  const emailOrders = orders.filter(
    (o) =>
      o.kind === "addon" &&
      o.domainName === domainName &&
      o.addons.some((a) => a.type === "email"),
  );
  // A pending add-on order means an add is already in flight.
  const pending = emailOrders.find((o) => o.status === "pending");
  if (pending) {
    return { order: pending, reused: true };
  }

  const addonInputs: AddonInput[] = [
    { type: "email", plan: input.plan ?? "starter", mailboxes: input.mailboxes ?? 1 },
  ];
  let addons;
  try {
    addons = buildAddons(addonInputs, 1);
  } catch (err) {
    throw new HttpError(err instanceof Error ? err.message : "invalid plan", 422);
  }
  const totalCents = addonTotalCents(addons);
  const paymentMethodId = await resolvePaymentMethod(userId, input.paymentMethodId);

  // Generation-numbered key: concurrent duplicate adds collapse onto the same
  // order, while a re-add after removal starts a fresh order/generation.
  const generation = emailOrders.length + 1;
  const { order, reused } = await weasel.createOrder({
    userId,
    domainName,
    kind: "addon",
    years: 1,
    purchaseType: "addon",
    priceCents: 0,
    totalCents,
    paymentMethodId,
    addons,
    idempotencyKey: `${userId}:${domainName}:email:${generation}`,
  });

  if (!reused && order.status === "pending") {
    await enqueuePurchase(order.id);
    await enqueueEmailJob("provision", { orderId: order.id });
  }
  return { order, reused };
}

/** Enqueues immediate deprovisioning of a domain's mailboxes. No refund. */
export async function removeEmail(userId: string, domainName: string) {
  await assertDomainOwnership(userId, domainName);
  await enqueueEmailJob("deprovision", { domainName, userId });
  return { status: "removing" };
}

export { EMAIL_PLANS };
