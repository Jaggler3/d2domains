export interface BuyResult {
  ok: boolean;
  unauthorized?: boolean;
  error?: string;
}

export async function buyDomain(domainName: string): Promise<BuyResult> {
  const attempt = () =>
    fetch("/api/v1/domains/buy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domainName, years: 1 }),
    });

  let res = await attempt();
  if (res.status === 401) {
    // session cookie may not be propagated to this request yet; retry once
    await new Promise((r) => setTimeout(r, 400));
    res = await attempt();
  }
  if (res.status === 401) return { ok: false, unauthorized: true };

  const data = (await res.json().catch(() => null)) as {
    error?: string;
  } | null;
  if (!res.ok) return { ok: false, error: data?.error ?? "purchase failed" };
  return { ok: true };
}
