export interface AddonLine {
  type: string;
  plan: string;
  mailboxes: number;
  years: number;
  priceCents: number;
}

export interface PaymentMethod {
  id: string;
  userId: string;
  provider: string;
  brand: string;
  last4: string;
  isDefault: boolean;
}

export interface EmailPlanOption {
  type: "email";
  plan: string;
  label: string;
  pricePerYearCents: number;
}

export interface Quote {
  domainName: string;
  purchasable: boolean;
  premium: boolean;
  purchaseType: string;
  years: number;
  annualPriceCents: number | null;
  renewalPriceCents: number | null;
  priceCents: number | null;
  totalCents: number | null;
  addonOptions: EmailPlanOption[];
}

export interface BuyInput {
  domainName: string;
  years: number;
  paymentMethodId?: string | null;
  addons?: AddonLine[];
}

export interface BuyResult {
  ok: boolean;
  unauthorized?: boolean;
  error?: string;
}

async function api<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; data: T | null }> {
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = (await res.json().catch(() => null)) as T | null;
  return { status: res.status, data };
}

export async function quoteDomain(
  domainName: string,
  years: number,
): Promise<Quote | null> {
  const { status, data } = await api<{ quote?: Quote }>("/api/v1/domains/quote", {
    method: "POST",
    body: { domainName, years },
  });
  if (status !== 200) return null;
  return data?.quote ?? null;
}

export async function getPaymentMethods(): Promise<PaymentMethod[]> {
  const { data } = await api<{ paymentMethods?: PaymentMethod[] }>(
    "/api/v1/billing/methods",
  );
  return data?.paymentMethods ?? [];
}

export async function addPaymentMethod(input: {
  brand: string;
  last4: string;
  expMonth?: number | null;
  expYear?: number | null;
}): Promise<PaymentMethod | null> {
  const { status, data } = await api<{ paymentMethod?: PaymentMethod }>(
    "/api/v1/billing/methods",
    { method: "POST", body: input },
  );
  if (status !== 201) return null;
  return data?.paymentMethod ?? null;
}

export async function setDefaultPaymentMethod(id: string): Promise<boolean> {
  const { status } = await api(`/api/v1/billing/methods/${id}/default`, {
    method: "POST",
  });
  return status === 200;
}

export async function removePaymentMethod(id: string): Promise<boolean> {
  const { status } = await api(`/api/v1/billing/methods/${id}`, {
    method: "DELETE",
  });
  return status === 204;
}

export async function buyDomain(input: BuyInput): Promise<BuyResult> {
  const attempt = () =>
    api<{ error?: string }>("/api/v1/domains/buy", {
      method: "POST",
      body: input,
    });

  let res = await attempt();
  if (res.status === 401) {
    // session cookie may not be propagated to this request yet; retry once
    await new Promise((r) => setTimeout(r, 400));
    res = await attempt();
  }
  if (res.status === 401) return { ok: false, unauthorized: true };
  if (res.status >= 400)
    return { ok: false, error: res.data?.error ?? "purchase failed" };
  return { ok: true };
}