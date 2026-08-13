import { HttpError } from "../lib/http";

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

export function createRegistryClient(config: { baseUrl: string }) {
  async function post<T>(
    path: string,
    body: unknown,
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${config.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
      return post<{ results: DomainSearchResult[] }>("/v1/search", {
        keyword,
        tldFilter,
      });
    },
    checkAvailability(domainNames: string[]) {
      return post<{ results: DomainSearchResult[] }>(
        "/v1/check-availability",
        { domainNames },
      );
    },
  };
}
