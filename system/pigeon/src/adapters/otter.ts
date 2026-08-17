import { HttpError } from "../lib/http";

export interface DnsRecord {
  id: string;
  zoneId: string;
  type: string;
  name: string;
  value: string;
  ttl: number;
  priority: number | null;
  registryRecordId: string | null;
  syncStatus: string;
  syncError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DnsRecordInput {
  type: string;
  name: string;
  value: string;
  ttl?: number;
  priority?: number | null;
}

export function createOtterClient(config: { baseUrl: string; internalToken: string }) {
  async function req<T>(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${config.baseUrl}${path}`, {
        method: init.method ?? "GET",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": config.internalToken,
          "x-request-id": crypto.randomUUID(),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch {
      throw new HttpError("dns service unavailable", 503);
    }
    const data = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    if (!res.ok) {
      throw new HttpError(data?.error ?? "dns service error", res.status);
    }
    return data as T;
  }

  const recordsBase = (domainName: string, userId: string) =>
    `/v1/zones/${encodeURIComponent(domainName)}/records?userId=${encodeURIComponent(userId)}`;

  return {
    listRecords(domainName: string, userId: string) {
      return req<{ zone: unknown; records: DnsRecord[] }>(recordsBase(domainName, userId));
    },
    createRecord(domainName: string, userId: string, record: DnsRecordInput) {
      return req<{ record: DnsRecord }>(recordsBase(domainName, userId), {
        method: "POST",
        body: record,
      });
    },
  };
}