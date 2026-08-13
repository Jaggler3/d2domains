import { createRegistryClient } from "../adapters/registry";
import { createWeaselClient, type DomainRow, type Order } from "../adapters/weasel";
import { enqueuePurchase, redis } from "./queue";
import { HttpError } from "../lib/http";
import { loadEnv } from "../config/env";

const env = loadEnv();

const registry = createRegistryClient({ baseUrl: env.REGISTRY_URL, internalToken: env.INTERNAL_TOKEN });
const weasel = createWeaselClient({ baseUrl: env.WEASEL_URL, internalToken: env.INTERNAL_TOKEN });

export async function clearSearchCache(): Promise<void> {
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(
      cursor,
      "MATCH",
      "domain:search:*",
      "COUNT",
      100,
    );
    cursor = next;
    if (keys.length > 0) await redis.del(...keys);
  } while (cursor !== "0");
}

export interface BuyInput {
  domainName: string;
  years?: number;
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
  const priceCents = Math.round((result.purchasePrice ?? 0) * 100);
  if (priceCents <= 0) throw new HttpError("could not determine price", 422);
  const purchaseType = result.premium ? "premium" : "registration";

  const idempotencyKey = `${userId}:${domainName}`;
  const { order, reused } = await weasel.createOrder({
    userId,
    domainName,
    years,
    purchaseType,
    priceCents,
    idempotencyKey,
  });

  if (reused) {
    if (order.status === "purchased") {
      throw new HttpError("you already own this domain", 409);
    }
    if (order.status === "failed") {
      await weasel.patchOrder(order.id, { status: "pending", error: null });
    } else {
      return order;
    }
  }

  await enqueuePurchase(order.id);
  await clearSearchCache();
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
