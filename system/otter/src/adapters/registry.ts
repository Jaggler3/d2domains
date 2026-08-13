import { HttpError } from "../lib/http";

export interface RegistryDnsRecord {
  id: string | number;
  type: string;
  host: string;
  fqdn: string;
  answer: string;
  ttl: number;
  priority: number | null;
}

export function createRegistryClient(config: { baseUrl: string }) {
  async function req<T>(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${config.baseUrl}${path}`, {
        method: init.method ?? "GET",
        headers: { "Content-Type": "application/json" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch {
      throw new HttpError("registry service unavailable", 503);
    }
    if (res.status === 204) return undefined as T;
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) {
      const status = res.status >= 500 ? 502 : res.status;
      throw new HttpError(
        data?.error ?? "registry error",
        status,
      );
    }
    return data as T;
  }

  return {
    listDnsRecords(domainName: string) {
      return req<{ records: RegistryDnsRecord[] }>(
        `/v1/dns/${encodeURIComponent(domainName)}/records`,
      );
    },
    createDnsRecord(
      domainName: string,
      record: { type: string; host: string; answer: string; ttl?: number; priority?: number | null },
    ) {
      return req<{ record: RegistryDnsRecord }>(
        `/v1/dns/${encodeURIComponent(domainName)}/records`,
        { method: "POST", body: record },
      );
    },
    updateDnsRecord(
      domainName: string,
      recordId: string,
      record: { type: string; host: string; answer: string; ttl?: number; priority?: number | null },
    ) {
      return req<{ record: RegistryDnsRecord }>(
        `/v1/dns/${encodeURIComponent(domainName)}/records/${recordId}`,
        { method: "PUT", body: record },
      );
    },
    deleteDnsRecord(domainName: string, recordId: string) {
      return req<undefined>(
        `/v1/dns/${encodeURIComponent(domainName)}/records/${recordId}`,
        { method: "DELETE" },
      );
    },
  };
}
