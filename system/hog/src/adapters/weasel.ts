import { HttpError } from "../lib/http";
import { getRequestId } from "../lib/request-id";
import type { AddonLine } from "../services/catalog";

export interface Order {
  id: string;
  userId: string;
  domainName: string;
  years: number;
  purchaseType: string;
  priceCents: number;
  totalCents: number;
  paymentMethodId: string | null;
  addons: AddonLine[];
  currency: string;
  status: string;
  idempotencyKey: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RawOrder {
  id: string;
  userId: string;
  domainName: string;
  years: number;
  purchaseType: string;
  priceCents: number;
  totalCents: number | null;
  paymentMethodId: string | null;
  addons: AddonLine[] | null;
  currency: string;
  status: string;
  idempotencyKey: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

function normalizeOrder(order: RawOrder): Order {
  return {
    ...order,
    totalCents: order.totalCents ?? order.priceCents,
    addons: order.addons ?? [],
  };
}

export interface DomainRow {
  id: string;
  userId: string;
  domainName: string;
  status: string;
  years: number;
  expiresAt: string;
  purchasedAt: string;
  orderId: string;
}

export function createWeaselClient(config: { baseUrl: string; internalToken: string }) {
  async function req<T>(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${config.baseUrl}${path}`, {
        method: init?.method ?? "GET",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": config.internalToken,
          ...(getRequestId() ? { "x-request-id": getRequestId() } : {}),
        },
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
    } catch {
      throw new HttpError("domains service unavailable", 503);
    }
    const data = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    if (!res.ok) {
      throw new HttpError(data?.error ?? "domains service error", res.status);
    }
    return data as T;
  }

  function orderResponse(
    data: { order: RawOrder },
  ): { order: Order } {
    return { order: normalizeOrder(data.order) };
  }

  return {
    createOrder(input: {
      userId: string;
      domainName: string;
      years: number;
      purchaseType: string;
      priceCents: number;
      totalCents: number;
      paymentMethodId?: string | null;
      addons: AddonLine[];
      idempotencyKey: string;
    }) {
      return req<{ order: RawOrder; reused: boolean }>("/internal/orders", {
        method: "POST",
        body: input,
      }).then(({ order, reused }) => ({ order: normalizeOrder(order), reused }));
    },
    patchOrder(
      id: string,
      patch: {
        status?: string;
        error?: string | null;
        totalCents?: number;
        paymentMethodId?: string | null;
        addons?: AddonLine[];
        years?: number;
      },
    ) {
      return req<{ order: RawOrder }>(`/internal/orders/${id}`, {
        method: "PATCH",
        body: patch,
      }).then(orderResponse);
    },
    getOrder(id: string) {
      return req<{ order: RawOrder }>(`/internal/orders/${id}`).then(orderResponse);
    },
    listOrders(userId: string) {
      return req<{ orders: RawOrder[] }>(
        `/internal/orders?userId=${encodeURIComponent(userId)}`,
      ).then(({ orders }) => ({ orders: orders.map(normalizeOrder) }));
    },
    listDomains(userId: string) {
      return req<{ domains: DomainRow[] }>(
        `/internal/domains?userId=${encodeURIComponent(userId)}`,
      );
    },
    getDomain(domainName: string, userId: string) {
      return req<{ domain: DomainRow }>(
        `/internal/domains/${encodeURIComponent(domainName)}?userId=${encodeURIComponent(userId)}`,
      );
    },
  };
}
