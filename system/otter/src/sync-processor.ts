export type SyncOp = "create" | "update" | "delete";

export interface DnsSyncPayload {
  recordId: string;
  op: SyncOp;
}

export interface SyncRecord {
  id: string;
  type: string;
  name: string;
  value: string;
  ttl: number;
  priority: number | null;
  registryRecordId: string | null;
}

export interface SyncZone {
  domainName: string;
}

export interface RegistryDnsRecord {
  id: string | number;
  type: string;
  host?: string;
  answer: string;
  ttl: number;
  priority: number | null;
}

export interface SyncDeps {
  getRecord(recordId: string): Promise<{ record: SyncRecord; zone: SyncZone } | null>;
  setSynced(recordId: string, registryRecordId: string): Promise<void>;
  markError(recordId: string, message: string): Promise<void>;
  deleteRecordLocal(recordId: string): Promise<void>;
  registry: {
    listDnsRecords(domainName: string): Promise<{ records: RegistryDnsRecord[] }>;
    createDnsRecord(domainName: string, record: unknown): Promise<{ record: RegistryDnsRecord }>;
    updateDnsRecord(domainName: string, recordId: string, record: unknown): Promise<{ record: RegistryDnsRecord }>;
    deleteDnsRecord(domainName: string, recordId: string): Promise<unknown>;
  };
}

function statusOf(err: unknown): number | undefined {
  if (err instanceof Error && "status" in err) {
    const status = (err as { status?: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

function isTerminal(err: unknown): boolean {
  const status = statusOf(err);
  return typeof status === "number" && status < 500 && status !== 429;
}

export function createSyncProcessor(deps: SyncDeps) {
  async function adopt(record: SyncRecord, domain: string): Promise<boolean> {
    try {
      const { records: remote } = await deps.registry.listDnsRecords(domain);
      const match = remote.find(
        (r) => r.type === record.type && (r.host ?? "@") === record.name,
      );
      if (!match) return false;
      await deps.setSynced(record.id, String(match.id));
      console.log(`[otter] reconciled ${record.type} ${record.name} (${domain}) as ${match.id}`);
      return true;
    } catch (err) {
      console.error(`[otter] reconcile failed for ${record.type} ${record.name} (${domain}):`, err);
      return false;
    }
  }

  return async function processSyncJob(jobData: DnsSyncPayload): Promise<void> {
    const found = await deps.getRecord(jobData.recordId);
    if (!found?.zone) {
      console.log(`[otter] record ${jobData.recordId} gone, skipping`);
      return;
    }
    const { record, zone } = found;
    const domain = zone.domainName;

    if (jobData.op === "delete") {
      if (record.registryRecordId) {
        await deps.registry.deleteDnsRecord(domain, record.registryRecordId);
      }
      await deps.deleteRecordLocal(record.id);
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
        const res = await deps.registry.updateDnsRecord(domain, record.registryRecordId, payload);
        await deps.setSynced(record.id, String(res.record.id));
        console.log(`[otter] synced ${record.type} ${record.name} (${domain})`);
      } else {
        try {
          const res = await deps.registry.createDnsRecord(domain, payload);
          await deps.setSynced(record.id, String(res.record.id));
          console.log(`[otter] created ${record.type} ${record.name} (${domain})`);
        } catch (err) {
          // create may have succeeded at the registry before our response timed
          // out; a 4xx here usually means the record already exists. Reconcile
          // by adopting the existing registry record instead of failing.
          if (isTerminal(err) && (await adopt(record, domain))) {
            return;
          }
          throw err;
        }
      }
    } catch (err) {
      if (isTerminal(err)) {
        const message = err instanceof Error ? err.message : "registry error";
        await deps.markError(record.id, message);
        console.error(`[otter] terminal sync error for record ${record.id}:`, message);
        return;
      }
      throw err;
    }
  };
}
