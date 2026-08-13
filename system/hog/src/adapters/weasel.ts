import { HttpError } from "../lib/http";
import { getRequestId } from "../lib/request-id";

export interface Order {
  id: string;
  userId: string;
  domainName: string;
  years: number;
  purchaseType: string;
  priceCents: number;
  currency: string;
  status: string;
  idempotencyKey: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
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

  return {
    createOrder(input: {
      userId: string;
      domainName: string;
      years: number;
      purchaseType: string;
      priceCents: number;
      idempotencyKey: string;
    }) {
      return req<{ order: Order; reused: boolean }>("/internal/orders", {
        method: "POST",
        body: input,
      });
    },
    patchOrder(
      id: string,
      patch: { status?: string; error?: string | null },
    ) {
      return req<{ order: Order }>(`/internal/orders/${id}`, {
        method: "PATCH",
        body: patch,
      });
    },
    getOrder(id: string) {
      return req<{ order: Order }>(`/internal/orders/${id}`);
    },
    listOrders(userId: string) {
      return req<{ orders: Order[] }>(
        `/internal/orders?userId=${encodeURIComponent(userId)}`,
      );
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
