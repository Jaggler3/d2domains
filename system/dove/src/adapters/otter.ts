import { HttpError } from "../lib/http";

export interface OtterRecordInput {
  type: string;
  name: string;
  value: string;
  ttl?: number;
  priority?: number | null;
}

export interface OtterRecord {
  id: string;
  zoneId: string;
  type: string;
  name: string;
  value: string;
  ttl: number;
  priority: number | null;
  syncStatus: string;
  createdAt: string;
  updatedAt: string;
}

function req(config: { baseUrl: string; internalToken: string }) {
  return async <T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> => {
    let res: Response;
    try {
      res = await fetch(`${config.baseUrl}${path}`, {
        method: init?.method ?? "GET",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": config.internalToken,
          "x-request-id": crypto.randomUUID(),
        },
        body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch {
      throw new HttpError("dns service unavailable", 503);
    }
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok && res.status !== 409) {
      throw new HttpError(data?.error ?? "dns service error", res.status);
    }
    return (data ?? {}) as T;
  };
}

export function createOtterClient(config: { baseUrl: string; internalToken: string }) {
  const call = req(config);

  const recordsBase = (domainName: string, userId: string) =>
    `/v1/zones/${encodeURIComponent(domainName)}/records?userId=${encodeURIComponent(userId)}`;

  async function createRecord(domainName: string, userId: string, input: OtterRecordInput) {
    await call<{ record?: OtterRecord }>(recordsBase(domainName, userId), {
      method: "POST",
      body: input,
    });
  }

  return {
    listRecords(domainName: string, userId: string) {
      return call<{ zone?: unknown; records?: OtterRecord[] }>(recordsBase(domainName, userId));
    },
    createRecord,
  };
}

export type OtterClient = ReturnType<typeof createOtterClient>;