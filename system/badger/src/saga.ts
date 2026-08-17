const REGISTRY_URL = Bun.env.REGISTRY_URL ?? "http://localhost:8783";
const WEASEL_URL = Bun.env.WEASEL_URL ?? "http://localhost:8781";
const WOMBAT_URL = Bun.env.WOMBAT_URL ?? "http://localhost:8782";
const INTERNAL_TOKEN = Bun.env.INTERNAL_TOKEN ?? "";

export interface Order {
  id: string;
  userId: string;
  domainName: string;
  years: number;
  purchaseType: string;
  priceCents: number;
  totalCents: number | null;
  paymentMethodId: string | null;
  status: string;
  error: string | null;
}

export class WorkerError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "WorkerError";
  }
}

export async function apiFetch(
  url: string,
  method: string,
  body: unknown,
): Promise<{ status: number; data: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-internal-token": INTERNAL_TOKEN,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new WorkerError(`network error calling ${url}`, true);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, data };
}

export async function getOrder(orderId: string): Promise<Order> {
  const { status, data } = await apiFetch(
    `${WEASEL_URL}/internal/orders/${orderId}`,
    "GET",
    undefined,
  );
  if (status === 404) throw new WorkerError(`order ${orderId} not found`, true);
  if (status >= 500) throw new WorkerError(`weasel error ${status}`, true);
  return data.order as Order;
}

export async function patchOrder(
  orderId: string,
  patch: { status: string; error?: string | null },
): Promise<void> {
  await apiFetch(`${WEASEL_URL}/internal/orders/${orderId}`, "PATCH", patch);
}

export async function chargeWombat(order: Order): Promise<void> {
  const { status, data } = await apiFetch(`${WOMBAT_URL}/internal/charges`, "POST", {
    orderId: order.id,
    userId: order.userId,
    amountCents: order.totalCents ?? order.priceCents,
    paymentMethodId: order.paymentMethodId ?? undefined,
  });
  if (status >= 400 && status < 500) {
    throw new WorkerError(`charge declined (${status})`, false);
  }
  if (status >= 500) throw new WorkerError(`wombat error ${status}`, true);
  if ((data as { reused?: boolean }).reused === undefined && status >= 300) {
    throw new WorkerError(`unexpected charge response ${status}`, true);
  }
  const chargeStatus = (data as { charge?: { status?: string } }).charge?.status;
  if (chargeStatus === "failed") {
    throw new WorkerError(
      `payment declined: ${(data as { charge?: { failureReason?: string } }).charge?.failureReason ?? "card declined"}`,
      false,
    );
  }
}

export async function registerAtRegistry(order: Order): Promise<void> {
  const { status, data } = await apiFetch(`${REGISTRY_URL}/v1/register`, "POST", {
    domainName: order.domainName,
    purchasePrice: order.priceCents / 100,
    purchaseType: order.purchaseType,
    years: order.years,
  });
  if (status >= 400 && status < 500) {
    throw new WorkerError(
      `registry declined (${status}): ${JSON.stringify(data)}`,
      false,
    );
  }
  if (status >= 500 || status === 429) {
    throw new WorkerError(`registry error ${status}`, true);
  }
}

export async function createDomainInWeasel(order: Order): Promise<void> {
  const expiresAt = new Date(
    Date.now() + order.years * 365 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { status } = await apiFetch(`${WEASEL_URL}/internal/domains`, "POST", {
    userId: order.userId,
    domainName: order.domainName,
    years: order.years,
    expiresAt,
    orderId: order.id,
  });
  if (status >= 500) throw new WorkerError(`weasel domain create error ${status}`, true);
}

/**
 * Runs the purchase saga for an order. Terminal failures mark the order
 * failed (and do not throw); transient failures throw so the caller (queue)
 * can retry.
 */
export async function processPurchase(orderId: string): Promise<void> {
  const order = await getOrder(orderId);

  if (order.status !== "pending") {
    console.log(`[badger] order ${orderId} already ${order.status}, skipping`);
    return;
  }

  try {
    await chargeWombat(order);
    console.log(`[badger] charged order ${orderId} (${order.priceCents}¢)`);

    await registerAtRegistry(order);
    console.log(`[badger] registered ${order.domainName} at registry`);

    await createDomainInWeasel(order);
    console.log(`[badger] domain ${order.domainName} created in weasel`);

    await patchOrder(orderId, { status: "purchased" });
    console.log(`[badger] order ${orderId} purchased`);
  } catch (err) {
    if (err instanceof WorkerError && !err.retryable) {
      console.error(`[badger] terminal failure for order ${orderId}:`, err.message);
      await patchOrder(orderId, { status: "failed", error: err.message });
      return;
    }
    throw err;
  }
}
