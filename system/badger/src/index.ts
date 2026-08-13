import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { processPurchase } from "./saga";

const REDIS_URL = Bun.env.REDIS_URL ?? "redis://localhost:6379";

const connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

const worker = new Worker("purchases", async (job) => {
  await processPurchase(String(job.data.orderId));
}, {
  connection,
  concurrency: 5,
});

worker.on("failed", (job, err) => {
  console.error(
    `[badger] transient failure (will retry) order ${job?.data?.orderId ?? "?"}:`,
    err,
  );
});

async function shutdown() {
  await worker.close();
  connection.disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("badger (purchase worker) consuming queue: purchases");
