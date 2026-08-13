import { createOtterClient, type DnsRecord, type DnsZone } from "../adapters/otter";
import { createWeaselClient } from "../adapters/weasel";
import { HttpError } from "../lib/http";
import { loadEnv } from "../config/env";

const env = loadEnv();

const otter = createOtterClient({ baseUrl: env.OTTER_URL });
const weasel = createWeaselClient({ baseUrl: env.WEASEL_URL });

async function assertOwnership(userId: string, domainName: string): Promise<void> {
  try {
    await weasel.getDomain(domainName, userId);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      throw new HttpError("domain not found", 404);
    }
    throw err;
  }
}

export const dnsService = {
  async listRecords(userId: string, domainName: string): Promise<{ zone: DnsZone; records: DnsRecord[] }> {
    await assertOwnership(userId, domainName);
    return otter.listRecords(domainName, userId);
  },

  async createRecord(
    userId: string,
    domainName: string,
    input: { type: string; name: string; value: string; ttl?: number; priority?: number | null },
  ): Promise<DnsRecord> {
    await assertOwnership(userId, domainName);
    const { record } = await otter.createRecord(domainName, userId, input);
    return record;
  },

  async updateRecord(
    userId: string,
    domainName: string,
    recordId: string,
    patch: Partial<{ type: string; name: string; value: string; ttl: number; priority: number | null }>,
  ): Promise<DnsRecord> {
    await assertOwnership(userId, domainName);
    const { record } = await otter.updateRecord(domainName, userId, recordId, patch);
    return record;
  },

  async deleteRecord(userId: string, domainName: string, recordId: string): Promise<void> {
    await assertOwnership(userId, domainName);
    await otter.deleteRecord(domainName, userId, recordId);
  },
};
