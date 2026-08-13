import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { records, zones } from "../db/schema";
import { createRegistryClient } from "../adapters/registry";
import { createSyncProcessor, type DnsSyncPayload, type SyncDeps } from "../sync-processor";
import { loadEnv } from "../config/env";

const env = loadEnv();

export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

export const dnsSyncQueue = new Queue("dns-sync", { connection: redis });

export async function enqueueDnsSync(payload: DnsSyncPayload): Promise<void> {
  try {
    await dnsSyncQueue.add("dns-sync", payload, {
      attempts: 5,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
  } catch (err) {
    console.error("[otter] failed to enqueue dns-sync job", err);
  }
}

const registry = createRegistryClient({
  baseUrl: env.REGISTRY_URL,
  internalToken: env.INTERNAL_TOKEN,
});

async function getRecord(recordId: string) {
  const record = await db.query.records.findFirst({
    where: eq(records.id, recordId),
  });
  if (!record) return null;
  const zone = await db.query.zones.findFirst({
    where: eq(zones.id, record.zoneId),
  });
  if (!zone) return null;
  return { record, zone };
}

async function setSynced(recordId: string, registryRecordId: string): Promise<void> {
  await db
    .update(records)
    .set({ syncStatus: "synced", syncError: null, registryRecordId, updatedAt: new Date() })
    .where(eq(records.id, recordId));
}

async function markError(recordId: string, message: string): Promise<void> {
  await db
    .update(records)
    .set({ syncStatus: "error", syncError: message, updatedAt: new Date() })
    .where(eq(records.id, recordId));
}

async function deleteRecordLocal(recordId: string): Promise<void> {
  await db.delete(records).where(eq(records.id, recordId));
}

const deps: SyncDeps = { getRecord, setSynced, markError, deleteRecordLocal, registry };

export const processSyncJob = createSyncProcessor(deps);

export function startDnsSyncWorker(): Worker {
  const worker = new Worker(
    "dns-sync",
    async (job) => {
      await processSyncJob(job.data as DnsSyncPayload);
    },
    {
      connection: redis,
      concurrency: 5,
    },
  );

  worker.on("failed", (job, err) => {
    console.error(
      `[otter] dns-sync job ${job?.id ?? "?"} failed (will retry):`,
      err,
    );
  });

  return worker;
}

export async function shutdownOtter(): Promise<void> {
  await dnsSyncQueue.close();
}
