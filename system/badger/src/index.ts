import { Worker, type Job } from "bullmq";
import { Redis } from "ioredis";

const REDIS_URL = Bun.env.REDIS_URL ?? "redis://localhost:6379";
const REGISTRY_URL = Bun.env.REGISTRY_URL ?? "http://localhost:8783";
const WEASEL_URL = Bun.env.WEASEL_URL ?? "http://localhost:8781";
const WOMBAT_URL = Bun.env.WOMBAT_URL ?? "http://localhost:8782";

interface Order {
  id: string;
  userId: string;
  domainName: string;
  years: number;
  purchaseType: string;
  priceCents: number;
  status: string;
  error: string | null;
}

class WorkerError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "WorkerError";
  }
}

async function apiFetch(
  url: string,
  method: string,
  body: unknown,
): Promise<{ status: number; data: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new WorkerError(`network error calling ${url}`, true);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, data };
}

async function getOrder(orderId: string): Promise<Order> {
  const { status, data } = await apiFetch(
    `${WEASEL_URL}/internal/orders/${orderId}`,
    "GET",
    undefined,
  );
  if (status === 404) throw new WorkerError(`order ${orderId} not found`, true);
  if (status >= 500) throw new WorkerError(`weasel error ${status}`, true);
  return data.order as Order;
}

async function patchOrder(
  orderId: string,
  patch: { status: string; error?: string | null },
): Promise<void> {
  await apiFetch(`${WEASEL_URL}/internal/orders/${orderId}`, "PATCH", patch);
}

async function chargeWombat(order: Order): Promise<void> {
  const { status, data } = await apiFetch(`${WOMBAT_URL}/internal/charges`, "POST", {
    orderId: order.id,
    userId: order.userId,
    amountCents: order.priceCents,
  });
  if (status >= 400 && status < 500) {
    throw new WorkerError(`charge declined (${status})`, false);
  }
  if (status >= 500) throw new WorkerError(`wombat error ${status}`, true);
  if ((data as { reused?: boolean }).reused === undefined && status >= 300) {
    throw new WorkerError(`unexpected charge response ${status}`, true);
  }
}

async function registerAtRegistry(order: Order): Promise<void> {
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

async function createDomainInWeasel(order: Order): Promise<void> {
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

async function processPurchase(job: Job): Promise<void> {
  const orderId = String(job.data.orderId);
  const order = await getOrder(orderId);

  if (order.status !== "pending") {
    console.log(`[badger] order ${orderId} already ${order.status}, skipping`);
    return;
  }

  await chargeWombat(order);
  console.log(`[badger] charged order ${orderId} (${order.priceCents}¢)`);

  await registerAtRegistry(order);
  console.log(`[badger] registered ${order.domainName} at registry`);

  await createDomainInWeasel(order);
  console.log(`[badger] domain ${order.domainName} created in weasel`);

  await patchOrder(orderId, { status: "purchased" });
  console.log(`[badger] order ${orderId} purchased`);
}

const connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

const worker = new Worker("purchases", processPurchase, {
  connection,
  concurrency: 5,
});

worker.on("failed", async (job, err) => {
  const orderId = String(job?.data?.orderId ?? "?");
  if (err instanceof WorkerError && !err.retryable) {
    console.error(`[badger] terminal failure for order ${orderId}:`, err.message);
    try {
      await patchOrder(orderId, { status: "failed", error: err.message });
    } catch (patchErr) {
      console.error(`[badger] failed to mark order ${orderId} failed:`, patchErr);
    }
  } else {
    console.error(`[badger] transient failure (will retry) order ${orderId}:`, err);
  }
});

async function shutdown() {
  await worker.close();
  connection.disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("badger (purchase worker) consuming queue: purchases");
