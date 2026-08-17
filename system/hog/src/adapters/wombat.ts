import { HttpError } from "../lib/http";
import { getRequestId } from "../lib/request-id";

export interface PaymentMethod {
  id: string;
  userId: string;
  provider: string;
  token: string;
  brand: string;
  last4: string;
  isDefault: boolean;
}

export interface AddPaymentMethodInput {
  brand: string;
  last4: string;
  token?: string;
  expMonth?: number | null;
  expYear?: number | null;
}

export function createWombatClient(config: { baseUrl: string; internalToken: string }) {
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
      throw new HttpError("billing service unavailable", 503);
    }
    const data = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    if (!res.ok) {
      throw new HttpError(data?.error ?? "billing service error", res.status);
    }
    return data as T;
  }

  return {
    listPaymentMethods(userId: string) {
      return req<{ paymentMethods: PaymentMethod[] }>(
        `/internal/payment-methods?userId=${encodeURIComponent(userId)}`,
      );
    },
    addPaymentMethod(userId: string, input: AddPaymentMethodInput) {
      return req<{ paymentMethod: PaymentMethod }>("/internal/payment-methods", {
        method: "POST",
        body: { userId, ...input },
      });
    },
    setDefaultPaymentMethod(userId: string, methodId: string) {
      return req<{ paymentMethods: PaymentMethod[] }>(
        `/internal/payment-methods/${encodeURIComponent(methodId)}/default?userId=${encodeURIComponent(userId)}`,
        { method: "POST" },
      );
    },
    deletePaymentMethod(userId: string, methodId: string) {
      return req<undefined>(
        `/internal/payment-methods/${encodeURIComponent(methodId)}?userId=${encodeURIComponent(userId)}`,
        { method: "DELETE" },
      );
    },
  };
}