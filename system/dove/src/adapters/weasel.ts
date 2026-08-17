import { HttpError } from "../lib/http";

export interface Order {
  id: string;
  userId: string;
  domainName: string;
  years: number;
  purchaseType: string;
  priceCents: number;
  totalCents: number | null;
  paymentMethodId: string | null;
  addons: { type: string; plan: string; mailboxes: number; years: number; priceCents: number }[] | null;
  status: string;
  error: string | null;
}

export function createWeaselClient(config: { baseUrl: string; internalToken: string }) {
  async function getOrder(orderId: string): Promise<Order> {
    let res: Response;
    try {
      res = await fetch(`${config.baseUrl}/internal/orders/${encodeURIComponent(orderId)}`, {
        headers: { "x-internal-token": config.internalToken },
      });
    } catch {
      throw new HttpError("weasel unavailable", 503);
    }
    const data = (await res.json().catch(() => null)) as { order?: Order; error?: string } | null;
    if (!res.ok) throw new HttpError(data?.error ?? "weasel error", res.status);
    if (!data?.order) throw new HttpError("order not found", 404);
    return data.order;
  }

  return { getOrder };
}