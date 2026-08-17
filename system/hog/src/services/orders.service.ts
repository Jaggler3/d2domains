import { createRegistryClient, type DomainSearchResult } from "../adapters/registry";
import { createWeaselClient, type DomainRow, type Order } from "../adapters/weasel";
import {
  EMAIL_PLANS,
  addonTotalCents,
  buildAddons,
  type AddonLine,
  type AddonInput,
  type EmailPlan,
} from "./catalog";
import { enqueueEmailProvision, enqueuePurchase, redis } from "./queue";
import { HttpError } from "../lib/http";
import { loadEnv } from "../config/env";

const env = loadEnv();

const registry = createRegistryClient({ baseUrl: env.REGISTRY_URL, internalToken: env.INTERNAL_TOKEN });
const weasel = createWeaselClient({ baseUrl: env.WEASEL_URL, internalToken: env.INTERNAL_TOKEN });

export async function clearSearchCacheForDomain(domainName: string): Promise<void> {
  const sld = domainName.split(".")[0];
  if (!sld) return;
  for (const pattern of [`domain:search:${sld}:*`, `domain:search:${domainName}:*`]) {
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100,
      );
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== "0");
  }
}

export interface BuyInput {
  domainName: string;
  years?: number;
  paymentMethodId?: string | null;
  addons?: AddonInput[];
}

export interface QuoteResult {
  domainName: string;
  purchasable: boolean;
  premium: boolean;
  purchaseType: string;
  years: number;
  annualPriceCents: number | null;
  renewalPriceCents: number | null;
  priceCents: number | null;
  totalCents: number | null;
  addonOptions: EmailPlan[];
}

export async function quoteDomain(
  userId: string,
  input: { domainName: string; years?: number },
): Promise<QuoteResult> {
  const domainName = input.domainName.trim().toLowerCase();
  const years = Math.min(Math.max(input.years ?? 1, 1), 10);
  if (!domainName) throw new HttpError("domainName is required", 422);

  const { results } = await registry.checkAvailability([domainName]);
  const result = results.find((r) => r.domainName === domainName);
  if (!result) throw new HttpError("domain not found", 404);

  const annualPriceCents =
    result.purchasePrice != null ? Math.round(result.purchasePrice * 100) : null;
  const renewalPriceCents =
    result.renewalPrice != null ? Math.round(result.renewalPrice * 100) : null;
  const priceCents =
    result.purchasable && annualPriceCents != null ? annualPriceCents * years : null;

  return {
    domainName,
    purchasable: result.purchasable,
    premium: result.premium,
    purchaseType: result.purchaseType,
    years,
    annualPriceCents,
    renewalPriceCents,
    priceCents,
    totalCents: priceCents,
    addonOptions: Object.values(EMAIL_PLANS),
  };
}

export async function buyDomain(userId: string, input: BuyInput): Promise<Order> {
  const domainName = input.domainName.trim().toLowerCase();
  const years = Math.min(Math.max(input.years ?? 1, 1), 10);
  if (!domainName) throw new HttpError("domainName is required", 422);

  const { results } = await registry.checkAvailability([domainName]);
  const result = results.find((r) => r.domainName === domainName);
  if (!result || !result.purchasable) {
    throw new HttpError("domain is not available", 409);
  }
  const priceCents = Math.round((result.purchasePrice ?? 0) * 100) * years;
  if (priceCents <= 0) throw new HttpError("could not determine price", 422);
  const purchaseType = result.premium ? "premium" : "registration";

  let addons: AddonLine[];
  try {
    addons = buildAddons(input.addons ?? [], years);
  } catch (err) {
    throw new HttpError(err instanceof Error ? err.message : "invalid addons", 422);
  }
  const totalCents = priceCents + addonTotalCents(addons);
  const paymentMethodId = input.paymentMethodId ?? null;

  const idempotencyKey = `${userId}:${domainName}`;
  const { order, reused } = await weasel.createOrder({
    userId,
    domainName,
    years,
    purchaseType,
    priceCents,
    totalCents,
    paymentMethodId,
    addons,
    idempotencyKey,
  });

  if (reused) {
    if (order.status === "purchased") {
      throw new HttpError("you already own this domain", 409);
    }
    if (order.status === "failed") {
      await weasel.patchOrder(order.id, {
        status: "pending",
        error: null,
        years,
        totalCents,
        paymentMethodId,
        addons,
      });
    } else {
      return order;
    }
  }

  await enqueuePurchase(order.id);
  if (addons.some((a) => a.type === "email")) {
    await enqueueEmailProvision(order.id);
  }
  await clearSearchCacheForDomain(domainName);
  return order;
}

export async function listDomains(userId: string): Promise<DomainRow[]> {
  const { domains } = await weasel.listDomains(userId);
  return domains;
}

export async function getOrder(
  userId: string,
  orderId: string,
): Promise<Order> {
  const { order } = await weasel.getOrder(orderId);
  if (order.userId !== userId) throw new HttpError("order not found", 404);
  return order;
}

export async function listOrders(userId: string): Promise<Order[]> {
  const { orders } = await weasel.listOrders(userId);
  return orders;
}
