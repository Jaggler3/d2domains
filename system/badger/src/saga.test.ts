import { afterEach, describe, expect, test } from "bun:test";
import { processPurchase, WorkerError } from "./saga";

type Route = {
  method: string;
  urlIncludes: string;
  status: number;
  body?: Record<string, unknown>;
};

interface Call {
  url: string;
  method: string;
  body?: unknown;
}

const originalFetch = globalThis.fetch;

function stubRoutes(routes: Route[]): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({
      url,
      method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const route = routes.find(
      (r) => r.method.toUpperCase() === method && url.includes(r.urlIncludes),
    );
    if (!route) throw new Error(`unexpected fetch: ${method} ${url}`);
    return new Response(JSON.stringify(route.body ?? {}), {
      status: route.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return calls;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const order = {
  id: "o1",
  userId: "u1",
  domainName: "test.com",
  years: 1,
  purchaseType: "registration",
  priceCents: 1299,
  totalCents: null as number | null,
  paymentMethodId: null as string | null,
  status: "pending",
  error: null,
};

function orderRoutes(overrides: Partial<typeof order> = {}): Route[] {
  const o = { ...order, ...overrides };
  return [
    { method: "GET", urlIncludes: "/internal/orders/o1", status: 200, body: { order: o } },
    { method: "POST", urlIncludes: "/internal/charges", status: 201, body: { charge: {}, reused: false } },
    { method: "POST", urlIncludes: "/v1/register", status: 201, body: { domainName: o.domainName } },
    { method: "POST", urlIncludes: "/internal/domains", status: 201, body: { domain: {} } },
    { method: "PATCH", urlIncludes: "/internal/orders/o1", status: 200, body: { order: o } },
  ];
}

describe("purchase saga", () => {
  test("happy path: charge, register, create domain, mark purchased", async () => {
    const calls = stubRoutes(orderRoutes());
    await expect(processPurchase("o1")).resolves.toBeUndefined();

    const called = (method: string, path: string) =>
      calls.some((c) => c.method === method && c.url.includes(path));
    expect(called("POST", "/internal/charges")).toBe(true);
    expect(called("POST", "/v1/register")).toBe(true);
    expect(called("POST", "/internal/domains")).toBe(true);

    const charge = calls.find((c) => c.url.includes("/internal/charges"));
    expect(charge?.body).toMatchObject({ orderId: "o1", userId: "u1", amountCents: 1299 });

    const register = calls.find((c) => c.url.includes("/v1/register"));
    expect(register?.body).toMatchObject({
      domainName: "test.com",
      purchasePrice: 12.99,
      purchaseType: "registration",
      years: 1,
    });

    const patches = calls.filter((c) => c.method === "PATCH");
    expect(patches.at(-1)?.body).toMatchObject({ status: "purchased" });
  });

  test("charges totalCents and passes paymentMethodId when present", async () => {
    const withAddon = {
      ...order,
      priceCents: 1299,
      totalCents: 4298,
      paymentMethodId: "pm_123",
      years: 1,
    };
    const calls = stubRoutes(orderRoutes(withAddon));
    await expect(processPurchase("o1")).resolves.toBeUndefined();

    const charge = calls.find((c) => c.url.includes("/internal/charges"));
    expect(charge?.body).toMatchObject({
      orderId: "o1",
      userId: "u1",
      amountCents: 4298,
      paymentMethodId: "pm_123",
    });

    const register = calls.find((c) => c.url.includes("/v1/register"));
    expect(register?.body).toMatchObject({ purchasePrice: 12.99 });
  });

  test("skips when order is already purchased (idempotent)", async () => {
    const calls = stubRoutes(orderRoutes({ status: "purchased" }));
    await processPurchase("o1");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
  });

  test("marks order failed when registry declines (409, terminal)", async () => {
    const calls = stubRoutes([
      { method: "GET", urlIncludes: "/internal/orders/o1", status: 200, body: { order } },
      { method: "POST", urlIncludes: "/internal/charges", status: 201, body: { charge: {}, reused: false } },
      { method: "POST", urlIncludes: "/v1/register", status: 409, body: { error: "domain already taken" } },
      { method: "PATCH", urlIncludes: "/internal/orders/o1", status: 200, body: { order } },
    ]);
    await expect(processPurchase("o1")).resolves.toBeUndefined();

    const patches = calls.filter((c) => c.method === "PATCH");
    expect(patches.at(-1)?.body).toMatchObject({
      status: "failed",
    });
    expect(String((patches.at(-1)?.body as { error?: string }).error ?? "")).toContain(
      "registry declined",
    );
  });

  test("rethrows transient registry errors (5xx) for retry", async () => {
    stubRoutes([
      { method: "GET", urlIncludes: "/internal/orders/o1", status: 200, body: { order } },
      { method: "POST", urlIncludes: "/internal/charges", status: 201, body: { charge: {}, reused: false } },
      { method: "POST", urlIncludes: "/v1/register", status: 500, body: {} },
    ]);
    await expect(processPurchase("o1")).rejects.toBeInstanceOf(WorkerError);
    await expect(processPurchase("o1")).rejects.toMatchObject({ retryable: true });
  });

  test("marks order failed when the charge is declined (4xx)", async () => {
    const calls = stubRoutes([
      { method: "GET", urlIncludes: "/internal/orders/o1", status: 200, body: { order } },
      { method: "POST", urlIncludes: "/internal/charges", status: 402, body: { error: "card declined" } },
      { method: "PATCH", urlIncludes: "/internal/orders/o1", status: 200, body: { order } },
    ]);
    await expect(processPurchase("o1")).resolves.toBeUndefined();
    const patches = calls.filter((c) => c.method === "PATCH");
    expect(patches.at(-1)?.body).toMatchObject({ status: "failed" });
    expect(String((patches.at(-1)?.body as { error?: string }).error ?? "")).toContain(
      "charge declined",
    );
  });

  test("marks order failed when the charge succeeds but the processor declined", async () => {
    const calls = stubRoutes([
      { method: "GET", urlIncludes: "/internal/orders/o1", status: 200, body: { order } },
      {
        method: "POST",
        urlIncludes: "/internal/charges",
        status: 201,
        body: { charge: { status: "failed", failureReason: "card declined (test rule)" }, reused: false },
      },
      { method: "PATCH", urlIncludes: "/internal/orders/o1", status: 200, body: { order } },
    ]);
    await expect(processPurchase("o1")).resolves.toBeUndefined();
    const patches = calls.filter((c) => c.method === "PATCH");
    expect(patches.at(-1)?.body).toMatchObject({ status: "failed" });
    expect(String((patches.at(-1)?.body as { error?: string }).error ?? "")).toContain(
      "payment declined",
    );
  });
});
