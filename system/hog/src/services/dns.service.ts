import { createOtterClient, type DnsRecord, type DnsZone } from "../adapters/otter";
import { assertDomainOwnership } from "./ownership";
import { loadEnv } from "../config/env";

const env = loadEnv();

const otter = createOtterClient({ baseUrl: env.OTTER_URL, internalToken: env.INTERNAL_TOKEN });

export const dnsService = {
  async listRecords(userId: string, domainName: string): Promise<{ zone: DnsZone; records: DnsRecord[] }> {
    await assertDomainOwnership(userId, domainName);
    return otter.listRecords(domainName, userId);
  },

  async createRecord(
    userId: string,
    domainName: string,
    input: { type: string; name: string; value: string; ttl?: number; priority?: number | null },
  ): Promise<DnsRecord> {
    await assertDomainOwnership(userId, domainName);
    const { record } = await otter.createRecord(domainName, userId, input);
    return record;
  },

  async updateRecord(
    userId: string,
    domainName: string,
    recordId: string,
    patch: Partial<{ type: string; name: string; value: string; ttl: number; priority: number | null }>,
  ): Promise<DnsRecord> {
    await assertDomainOwnership(userId, domainName);
    const { record } = await otter.updateRecord(domainName, userId, recordId, patch);
    return record;
  },

  async deleteRecord(userId: string, domainName: string, recordId: string): Promise<void> {
    await assertDomainOwnership(userId, domainName);
    await otter.deleteRecord(domainName, userId, recordId);
  },
};
