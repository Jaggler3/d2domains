import { cache } from "react";
import { cookies } from "next/headers";

const HOG_URL = process.env.HOG_URL ?? "http://localhost:8787";

export interface SessionUser {
  id: string;
  email: string;
  createdAt: string;
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

export interface Order {
  id: string;
  userId: string;
  domainName: string;
  years: number;
  purchaseType: string;
  priceCents: number;
  currency: string;
  status: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  try {
    const cookieStore = await cookies();
    const res = await fetch(`${HOG_URL}/api/v1/auth/me`, {
      headers: { cookie: cookieStore.toString() },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { user?: SessionUser };
    return data.user ?? null;
  } catch {
    return null;
  }
});

export const getMyDomains = cache(async (): Promise<DomainRow[]> => {
  try {
    const cookieStore = await cookies();
    const res = await fetch(`${HOG_URL}/api/v1/domains`, {
      headers: { cookie: cookieStore.toString() },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { domains?: DomainRow[] };
    return data.domains ?? [];
  } catch {
    return [];
  }
});

export const getMyOrders = cache(async (): Promise<Order[]> => {
  try {
    const cookieStore = await cookies();
    const res = await fetch(`${HOG_URL}/api/v1/orders`, {
      headers: { cookie: cookieStore.toString() },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { orders?: Order[] };
    return data.orders ?? [];
  } catch {
    return [];
  }
});
