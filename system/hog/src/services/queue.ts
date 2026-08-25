import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { loadEnv } from "../config/env";

const env = loadEnv();

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
});

export const domainsQueue = new Queue("domains-jobs", {
  connection: redis,
});

export const purchasesQueue = new Queue("purchases", {
  connection: redis,
});

export const emailQueue = new Queue("email-jobs", {
  connection: redis,
});

export interface SearchLogPayload {
  userId: string;
  keyword: string;
  resultCount: number;
  cached: boolean;
}

export async function enqueueSearchLog(payload: SearchLogPayload): Promise<void> {
  try {
    await domainsQueue.add("search-log", payload, {
      attempts: 3,
      backoff: { type: "exponential", delay: 200 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
  } catch (err) {
    console.error("[hog] failed to enqueue search-log job", err);
  }
}

export async function enqueuePurchase(orderId: string): Promise<void> {
  try {
    await purchasesQueue.add(
      "purchase",
      { orderId },
      {
        attempts: 5,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );
  } catch (err) {
    console.error("[hog] failed to enqueue purchase job", err);
  }
}

export async function enqueueEmailJob(
  name: "provision" | "deprovision",
  data: { orderId?: string; domainName?: string; userId?: string },
): Promise<void> {
  try {
    await emailQueue.add(
      name,
      data,
      {
        // Provisioning waits on async dependencies (registry purchase,
        // stalwart DKIM generation). A fixed short cadence lands work within
        // seconds of its dependency resolving, unlike exponential backoff
        // which stretches past a minute after a handful of attempts.
        attempts: 30,
        backoff: { type: "fixed", delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );
  } catch (err) {
    console.error(`[hog] failed to enqueue email job ${name}`, err);
  }
}

export async function enqueueEmailProvision(orderId: string): Promise<void> {
  await enqueueEmailJob("provision", { orderId });
}

export async function shutdownQueue(): Promise<void> {
  await domainsQueue.close();
  await purchasesQueue.close();
  await emailQueue.close();
}
