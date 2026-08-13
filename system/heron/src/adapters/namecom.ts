import { withRetry } from "../lib/retry";

export interface RegistrySearchResult {
  domainName: string;
  sld?: string;
  tld?: string;
  purchasable?: boolean;
  premium?: boolean;
  purchasePrice?: number;
  purchaseType?: string;
  renewalPrice?: number;
}

export interface RegistryConfig {
  baseUrl: string;
  username: string;
  token: string;
  timeoutMs?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
}

const DEFAULT_CONFIG = {
  timeoutMs: 5000,
  maxAttempts: 3,
  baseDelayMs: 200,
};

export class RegistryError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "RegistryError";
  }
}

function basicAuth(username: string, token: string): string {
  return `Basic ${Buffer.from(`${username}:${token}`).toString("base64")}`;
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

export function createRegistryClient(config: RegistryConfig) {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  async function request<T>(path: string, body: unknown): Promise<T> {
    return withRetry(
      () => registryFetch<T>(path, body),
      {
        maxAttempts: cfg.maxAttempts,
        baseDelayMs: cfg.baseDelayMs,
        breaker: { windowMs: 60_000, failureThreshold: 5, openMs: 30_000 },
        isRetryable: (err) =>
          err instanceof RegistryError && err.retryable,
        retryAfterMs: (err) =>
          err instanceof RegistryError ? err.retryAfterMs : null,
      },
    );
  }

  async function registryFetch<T>(path: string, body: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${cfg.baseUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: basicAuth(cfg.username, cfg.token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      throw new RegistryError("registry network error", 0, true);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
      throw new RegistryError(
        `registry responded ${res.status}`,
        res.status,
        retryable,
        res.status === 429 ? parseRetryAfter(res.headers.get("retry-after")) : null,
      );
    }
    return (await res.json()) as T;
  }

  return {
    search(keyword: string, tldFilter?: string[], timeoutMs = 2000) {
      return request<{ results: RegistrySearchResult[] }>(
        "/v4/domains:search",
        { keyword, timeout: timeoutMs, ...(tldFilter ? { tldFilter } : {}) },
      );
    },
    checkAvailability(domainNames: string[]) {
      return request<{ results: RegistrySearchResult[] }>(
        "/v4/domains:checkAvailability",
        { domainNames },
      );
    },
    createDomain(input: {
      domainName: string;
      purchasePrice: number;
      purchaseType: string;
      years: number;
    }) {
      return request<{ domain: { domainName: string }; order: number; totalPaid: number }>(
        "/v4/domains",
        {
          domain: { domainName: input.domainName },
          purchasePrice: input.purchasePrice,
          purchaseType: input.purchaseType,
          years: input.years,
        },
      );
    },
  };
}
