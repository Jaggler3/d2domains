import { HttpError } from "../lib/http";

export interface AddonLine {
  type: string;
  plan: string;
  mailboxes: number;
  years: number;
  priceCents: number;
}

export interface Order {
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
  error: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export function createWeaselClient(config: { baseUrl: string; internalToken: string }) {
  async function req<T>(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${config.baseUrl}${path}`, {
        method: init.method ?? "GET",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": config.internalToken,
          "x-request-id": crypto.randomUUID(),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
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
    getOrder(id: string) {
      return req<{ order: Order }>(`/internal/orders/${encodeURIComponent(id)}`);
    },
  };
}