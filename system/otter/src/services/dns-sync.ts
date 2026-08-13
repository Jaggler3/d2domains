import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { records, zones } from "../db/schema";
import { createRegistryClient } from "../adapters/registry";
import { HttpError } from "../lib/http";
import { loadEnv } from "../config/env";

const env = loadEnv();

export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

export const dnsSyncQueue = new Queue("dns-sync", { connection: redis });

export type SyncOp = "create" | "update" | "delete";

export interface DnsSyncPayload {
  recordId: string;
  op: SyncOp;
}

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

const registry = createRegistryClient({ baseUrl: env.REGISTRY_URL });

async function getRecord(recordId: string) {
  const record = await db.query.records.findFirst({
    where: eq(records.id, recordId),
  });
  if (!record) return null;
  const zone = await db.query.zones.findFirst({
    where: eq(zones.id, record.zoneId),
  });
  return { record, zone };
}

async function markError(recordId: string, message: string): Promise<void> {
  await db
    .update(records)
    .set({ syncStatus: "error", syncError: message, updatedAt: new Date() })
    .where(eq(records.id, recordId));
}

async function adoptRecord(
  record: typeof records.$inferSelect,
  domain: string,
  type: string,
  host: string,
): Promise<boolean> {
  try {
    const { records: remote } = await registry.listDnsRecords(domain);
    const match = remote.find(
      (r) => r.type === type && (r.host ?? "@") === host,
    );
    if (!match) return false;
    await db
      .update(records)
      .set({
        syncStatus: "synced",
        syncError: null,
        registryRecordId: String(match.id),
        updatedAt: new Date(),
      })
      .where(eq(records.id, record.id));
    console.log(`[otter] reconciled ${type} ${host} (${domain}) as ${match.id}`);
    return true;
  } catch (err) {
    console.error(`[otter] reconcile failed for ${type} ${host} (${domain}):`, err);
    return false;
  }
}

async function processSyncJob(jobData: DnsSyncPayload): Promise<void> {
  const found = await getRecord(jobData.recordId);
  if (!found || !found.zone) {
    console.log(`[otter] record ${jobData.recordId} gone, skipping`);
    return;
  }
  const { record, zone } = found;
  const domain = zone.domainName;

  if (jobData.op === "delete") {
    if (record.registryRecordId) {
      await registry.deleteDnsRecord(domain, record.registryRecordId);
    }
    await db.delete(records).where(eq(records.id, record.id));
    console.log(`[otter] deleted ${record.type} ${record.name} from ${domain}`);
    return;
  }

  const payload = {
    type: record.type,
    host: record.name,
    answer: record.value,
    ttl: record.ttl,
    priority: record.priority,
  };

  try {
    if (record.registryRecordId) {
      const res = await registry.updateDnsRecord(
        domain,
        record.registryRecordId,
        payload,
      );
      await db
        .update(records)
        .set({
          syncStatus: "synced",
          syncError: null,
          registryRecordId: String(res.record.id),
          updatedAt: new Date(),
        })
        .where(eq(records.id, record.id));
      console.log(`[otter] synced ${record.type} ${record.name} (${domain})`);
    } else {
      try {
        const res = await registry.createDnsRecord(domain, payload);
        await db
          .update(records)
          .set({
            syncStatus: "synced",
            syncError: null,
            registryRecordId: String(res.record.id),
            updatedAt: new Date(),
          })
          .where(eq(records.id, record.id));
        console.log(`[otter] created ${record.type} ${record.name} (${domain})`);
      } catch (err) {
        // create may have succeeded at the registry before our response timed
        // out; a 4xx here usually means the record already exists. Reconcile by
        // adopting the existing registry record instead of failing.
        if (
          err instanceof HttpError &&
          err.status < 500 &&
          err.status !== 429 &&
          (await adoptRecord(record, domain, record.type, record.name))
        ) {
          return;
        }
        throw err;
      }
    }
  } catch (err) {
    if (err instanceof HttpError && err.status < 500 && err.status !== 429) {
      await markError(record.id, err.message);
      console.error(`[otter] terminal sync error for record ${record.id}:`, err.message);
      return;
    }
    throw err;
  }
}

export function startDnsSyncWorker(): Worker {
  const worker = new Worker("dns-sync", async (job) => {
    await processSyncJob(job.data as DnsSyncPayload);
  }, {
    connection: redis,
    concurrency: 5,
  });

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
