import { HttpError } from "../lib/http";
import { getRequestId } from "../lib/request-id";

export interface DomainSearchResult {
  domainName: string;
  sld: string;
  tld: string;
  purchasable: boolean;
  premium: boolean;
  purchasePrice: number | null;
  purchaseType: string;
  renewalPrice: number | null;
}

export interface RegistryDomainSettings {
  domainName: string;
  nameservers: string[];
  privacyEnabled: boolean;
  locked: boolean;
  autorenewEnabled: boolean;
  expireDate: string;
  createDate: string;
  renewalPrice: number;
}

export function createRegistryClient(config: { baseUrl: string; internalToken: string }) {
  async function req<T>(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${config.baseUrl}${path}`, {
        method: init.method ?? "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": config.internalToken,
          ...(getRequestId() ? { "x-request-id": getRequestId() } : {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch {
      throw new HttpError("registry service unavailable", 503);
    }
    const data = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    if (!res.ok) {
      throw new HttpError(
        data?.error ?? "registry error",
        res.status === 429 ? 429 : 502,
      );
    }
    return data as T;
  }

  return {
    search(keyword: string, tldFilter?: string[]) {
      return req<{ results: DomainSearchResult[] }>("/v1/search", {
        body: { keyword, tldFilter },
      });
    },
    checkAvailability(domainNames: string[]) {
      return req<{ results: DomainSearchResult[] }>("/v1/check-availability", {
        body: { domainNames },
      });
    },
    getDomainSettings(domainName: string) {
      return req<{ domain: RegistryDomainSettings }>(
        `/v1/domains/${encodeURIComponent(domainName)}`,
        { method: "GET" },
      );
    },
    setAutorenew(domainName: string, enabled: boolean) {
      return req<{ domain: RegistryDomainSettings }>(
        `/v1/domains/${encodeURIComponent(domainName)}/autorenew`,
        { body: { enabled } },
      );
    },
    setPrivacy(domainName: string, enabled: boolean) {
      return req<{ domain: RegistryDomainSettings }>(
        `/v1/domains/${encodeURIComponent(domainName)}/privacy`,
        { body: { enabled } },
      );
    },
    setNameservers(domainName: string, nameservers: string[]) {
      return req<{ domain: RegistryDomainSettings }>(
        `/v1/domains/${encodeURIComponent(domainName)}/nameservers`,
        { body: { nameservers } },
      );
    },
    setLock(domainName: string, locked: boolean) {
      return req<{ domain: RegistryDomainSettings }>(
        `/v1/domains/${encodeURIComponent(domainName)}/lock`,
        { body: { enabled: locked } },
      );
    },
  };
}
