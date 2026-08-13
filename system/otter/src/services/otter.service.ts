import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { records, zones, type Record, type Zone } from "../db/schema";
import { createRegistryClient } from "../adapters/registry";
import { enqueueDnsSync } from "./dns-sync";
import { HttpError } from "../lib/http";
import { loadEnv } from "../config/env";

const env = loadEnv();
const registry = createRegistryClient({ baseUrl: env.REGISTRY_URL });

export const RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "CAA"] as const;

export interface RecordInput {
  type: string;
  name: string;
  value: string;
  ttl?: number;
  priority?: number | null;
}

async function getOrCreateZone(userId: string, domainName: string): Promise<Zone> {
  const existing = await db.query.zones.findFirst({
    where: eq(zones.domainName, domainName),
  });
  if (existing) {
    if (existing.userId !== userId) {
      throw new HttpError("zone belongs to another user", 403);
    }
    return existing;
  }
  const [zone] = await db
    .insert(zones)
    .values({ userId, domainName })
    .returning();
  if (!zone) throw new HttpError("failed to create zone", 500);
  return zone;
}

async function ensurePulled(zone: Zone): Promise<void> {
  if (zone.pulled) return;
  let remote: { records: { id: string; type: string; host: string; answer: string; ttl: number; priority: number | null }[] } = { records: [] };
  try {
    remote = await registry.listDnsRecords(zone.domainName);
  } catch (err) {
    console.error(`[otter] pull failed for ${zone.domainName}:`, err);
  }
  for (const r of remote.records) {
    await db.insert(records).values({
      zoneId: zone.id,
      type: r.type,
      name: r.host,
      value: r.answer,
      ttl: r.ttl,
      priority: r.priority,
      registryRecordId: r.id,
      syncStatus: "synced",
    });
  }
  await db.update(zones).set({ pulled: true }).where(eq(zones.id, zone.id));
}

async function findZoneFor(userId: string, domainName: string): Promise<Zone> {
  const zone = await db.query.zones.findFirst({
    where: eq(zones.domainName, domainName),
  });
  if (!zone) throw new HttpError("zone not found", 404);
  if (zone.userId !== userId) throw new HttpError("zone belongs to another user", 403);
  return zone;
}

export const otterService = {
  async listRecords(userId: string, domainName: string) {
    const zone = await getOrCreateZone(userId, domainName);
    await ensurePulled(zone);
    const freshZone = await db.query.zones.findFirst({
      where: eq(zones.id, zone.id),
    });
    const result = await db.query.records.findMany({
      where: eq(records.zoneId, zone.id),
      orderBy: (r, { asc }) => [asc(r.type), asc(r.name)],
    });
    return { zone: freshZone ?? zone, records: result };
  },

  async createRecord(userId: string, domainName: string, input: RecordInput) {
    const zone = await getOrCreateZone(userId, domainName);
    await ensurePulled(zone);
    const [record] = await db
      .insert(records)
      .values({
        zoneId: zone.id,
        type: input.type,
        name: input.name,
        value: input.value,
        ttl: input.ttl ?? 3600,
        priority: input.priority ?? null,
        syncStatus: "pending",
      })
      .returning();
    if (!record) throw new HttpError("failed to create record", 500);
    await enqueueDnsSync({ recordId: record.id, op: "create" });
    return record;
  },

  async updateRecord(userId: string, domainName: string, recordId: string, patch: Partial<RecordInput>) {
    const zone = await findZoneFor(userId, domainName);
    const existing = await db.query.records.findFirst({
      where: and(eq(records.id, recordId), eq(records.zoneId, zone.id)),
    });
    if (!existing) throw new HttpError("record not found", 404);
    const [record] = await db
      .update(records)
      .set({
        ...(patch.type ? { type: patch.type } : {}),
        ...(patch.name ? { name: patch.name } : {}),
        ...(patch.value ? { value: patch.value } : {}),
        ...(patch.ttl !== undefined ? { ttl: patch.ttl } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        syncStatus: "pending",
        syncError: null,
        updatedAt: new Date(),
      })
      .where(eq(records.id, recordId))
      .returning();
    if (!record) throw new HttpError("failed to update record", 500);
    await enqueueDnsSync({ recordId: record.id, op: "update" });
    return record;
  },

  async deleteRecord(userId: string, domainName: string, recordId: string) {
    const zone = await findZoneFor(userId, domainName);
    const existing = await db.query.records.findFirst({
      where: and(eq(records.id, recordId), eq(records.zoneId, zone.id)),
    });
    if (!existing) throw new HttpError("record not found", 404);
    await db
      .update(records)
      .set({ syncStatus: "deleting", updatedAt: new Date() })
      .where(eq(records.id, recordId));
    await enqueueDnsSync({ recordId, op: "delete" });
  },

  async getZone(userId: string, domainName: string) {
    return findZoneFor(userId, domainName);
  },
};
