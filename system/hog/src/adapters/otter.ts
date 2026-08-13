import { HttpError } from "../lib/http";
import { getRequestId } from "../lib/request-id";

export interface DnsZone {
  id: string;
  userId: string;
  domainName: string;
  pulled: boolean;
  createdAt: string;
}

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
          ...(getRequestId() ? { "x-request-id": getRequestId() } : {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch {
      throw new HttpError("dns service unavailable", 503);
    }
    if (res.status === 204) return undefined as T;
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) {
      throw new HttpError(data?.error ?? "dns service error", res.status);
    }
    return data as T;
  }

  const zoneBase = (domainName: string, userId: string) =>
    `/v1/zones/${encodeURIComponent(domainName)}/records?userId=${encodeURIComponent(userId)}`;

  return {
    listRecords(domainName: string, userId: string) {
      return req<{ zone: DnsZone; records: DnsRecord[] }>(zoneBase(domainName, userId));
    },
    createRecord(
      domainName: string,
      userId: string,
      input: { type: string; name: string; value: string; ttl?: number; priority?: number | null },
    ) {
      return req<{ record: DnsRecord }>(zoneBase(domainName, userId), {
        method: "POST",
        body: input,
      });
    },
    updateRecord(
      domainName: string,
      userId: string,
      recordId: string,
      patch: Partial<{ type: string; name: string; value: string; ttl: number; priority: number | null }>,
    ) {
      return req<{ record: DnsRecord }>(
        `/v1/zones/${encodeURIComponent(domainName)}/records/${recordId}?userId=${encodeURIComponent(userId)}`,
        { method: "PATCH", body: patch },
      );
    },
    deleteRecord(domainName: string, userId: string, recordId: string) {
      return req<undefined>(
        `/v1/zones/${encodeURIComponent(domainName)}/records/${recordId}?userId=${encodeURIComponent(userId)}`,
        { method: "DELETE" },
      );
    },
  };
}
