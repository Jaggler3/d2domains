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

export interface RegistryDnsRecord {
  id: string | number;
  type: string;
  host: string;
  fqdn: string;
  answer: string;
  ttl: number;
  priority: number | null;
}

export interface NewDnsRecord {
  type: string;
  host: string;
  answer: string;
  ttl?: number;
  priority?: number | null;
}

export interface RegistryContact {
  firstName?: string;
  lastName?: string;
  organization?: string;
  email?: string;
  phone?: string;
  country?: string;
}

export interface RegistryDomainContacts {
  registrant?: RegistryContact;
  admin?: RegistryContact;
  tech?: RegistryContact;
  billing?: RegistryContact;
}

export interface RegistryDomain {
  domainName: string;
  nameservers: string[];
  privacyEnabled: boolean;
  locked: boolean;
  autorenewEnabled: boolean;
  expireDate: string;
  createDate: string;
  renewalPrice: number;
  contacts?: RegistryDomainContacts;
}

export interface RegistryDomainPricing {
  purchasePrice: number;
  renewalPrice: number;
  transferPrice: number;
  premium: boolean;
}

export interface RegistryConfig {
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
  registrantContactId?: string;
  tldPrices?: Record<string, number>;
  defaultTldPrice?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
}

export interface RegistryContactInput {
  firstName: string;
  lastName: string;
  email: string;
  organization?: string;
  address1: string;
  address2?: string;
  city: string;
  country: string;
  stateProvince?: string;
  postalCode?: string;
  phone: string;
  phoneExt?: string;
}

const DEFAULT_CONFIG = {
  timeoutMs: 5000,
  maxAttempts: 3,
  baseDelayMs: 200,
};

const REGISTER_POLL_INTERVAL_MS = 500;
const REGISTER_POLL_MAX_TRIES = 40;

interface SpaceshipAvailability {
  domain: string;
  result: string;
  premiumPricing?: { operation: string; price: number; currency: string }[];
}

interface SpaceshipAsyncOperation {
  status: "pending" | "success" | "failed";
  type?: string;
  details?: unknown;
}

interface SpaceshipDomainInfo {
  name?: string;
  unicodeName?: string;
  isPremium?: boolean;
  autoRenew?: boolean;
  registrationDate?: string;
  expirationDate?: string;
  lifecycleStatus?: string;
  eppStatuses?: string[];
  privacyProtection?: { level?: string };
  nameservers?: { provider?: string; hosts?: string[] };
  contacts?: Record<string, string>;
}

interface SpaceshipDnsItem {
  type?: string;
  name?: string;
  ttl?: number;
  priority?: number;
  address?: string;
  host?: string;
  value?: string;
  data?: string;
  target?: string;
  answer?: string;
  [key: string]: unknown;
}

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

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

function valueKeyForType(type: string): string {
  switch (type.toUpperCase()) {
    case "A":
    case "AAAA":
      return "address";
    case "CNAME":
    case "NS":
    case "MX":
      return "host";
    default:
      return "value";
  }
}

function extractAnswer(item: SpaceshipDnsItem): string {
  const keys = [
    valueKeyForType(String(item.type ?? "")),
    ...["address", "host", "value", "data", "target", "answer"],
  ];
  for (const key of keys) {
    const v = item[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return "";
}

function fqdnOf(name: string, domain: string): string {
  return name === "@" || name === "" ? domain : `${name}.${domain}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function encodeRecordId(input: {
  type: string;
  name: string;
  value: string;
  ttl: number;
  priority: number | null;
}): string {
  return Buffer.from(JSON.stringify(input)).toString("base64url");
}

function decodeRecordId(
  id: string,
): { type: string; name: string; value: string; ttl: number; priority: number | null } {
  try {
    const parsed = JSON.parse(Buffer.from(id, "base64url").toString()) as {
      type?: unknown;
      name?: unknown;
      value?: unknown;
      ttl?: unknown;
      priority?: unknown;
    };
    if (
      typeof parsed.type !== "string" ||
      typeof parsed.name !== "string" ||
      typeof parsed.value !== "string"
    ) {
      throw new Error("missing fields");
    }
    return {
      type: parsed.type,
      name: parsed.name,
      value: parsed.value,
      ttl: typeof parsed.ttl === "number" ? parsed.ttl : 3600,
      priority: typeof parsed.priority === "number" ? parsed.priority : null,
    };
  } catch {
    throw new RegistryError(`invalid registry record id`, 422, false);
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function createRegistryClient(config: RegistryConfig) {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  async function registryFetch(
    path: string,
    init: { method?: string; body?: unknown },
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${cfg.baseUrl}${path}`, {
        method: init.method ?? "GET",
        headers: {
          "X-Api-Key": cfg.apiKey,
          "X-Api-Secret": cfg.apiSecret,
          "Content-Type": "application/json",
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      });
    } catch {
      throw new RegistryError("registry network error", 0, true);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
      throw new RegistryError(
        `registry responded ${res.status}${bodyText ? `: ${bodyText.slice(0, 200)}` : ""}`,
        res.status,
        retryable,
        res.status === 429 ? parseRetryAfter(res.headers.get("retry-after")) : null,
      );
    }
    return res;
  }

  async function requestRaw(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<{ status: number; headers: Headers; body: unknown }> {
    const res = await withRetry(() => registryFetch(path, init), {
      maxAttempts: cfg.maxAttempts,
      baseDelayMs: cfg.baseDelayMs,
      breaker: { windowMs: 60_000, failureThreshold: 5, openMs: 30_000 },
      isRetryable: (err) => err instanceof RegistryError && err.retryable,
      retryAfterMs: (err) =>
        err instanceof RegistryError ? err.retryAfterMs : null,
    });
    const body = res.status === 204 ? undefined : await res.json().catch(() => undefined);
    return { status: res.status, headers: res.headers, body };
  }

  async function request<T>(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const { body } = await requestRaw(path, init);
    return body as T;
  }

  function mapAvailability(item: SpaceshipAvailability): RegistrySearchResult {
    if (item.result !== "available") {
      return { domainName: item.domain };
    }
    const pricing = item.premiumPricing ?? [];
    const register =
      pricing.find((p) => p.operation === "register") ?? pricing[0];
    const premium = pricing.length > 0 && Boolean(register);
    const dot = item.domain.lastIndexOf(".");
    const tld = dot > 0 ? item.domain.slice(dot + 1) : "";
    const catalogPrice = cfg.tldPrices?.[tld] ?? cfg.defaultTldPrice;
    return {
      domainName: item.domain,
      purchasable: true,
      premium,
      purchasePrice: register?.price ?? catalogPrice,
      purchaseType: premium ? "premium" : "registration",
      renewalPrice: register?.price ?? catalogPrice,
    };
  }

  async function checkAvailabilityBatch(
    domainNames: string[],
  ): Promise<RegistrySearchResult[]> {
    const data = await request<{ domains?: SpaceshipAvailability[] }>(
      "/v1/domains/available",
      { method: "POST", body: { domains: domainNames } },
    );
    return (data.domains ?? []).map(mapAvailability);
  }

  function toSpaceshipDnsItem(record: {
    type: string;
    host: string;
    answer: string;
    ttl?: number;
    priority?: number | null;
  }): SpaceshipDnsItem {
    const item: SpaceshipDnsItem = {
      type: record.type.toUpperCase(),
      name: record.host === "" ? "@" : record.host.toLowerCase(),
      ttl: record.ttl ?? 3600,
    };
    item[valueKeyForType(record.type)] = record.answer;
    if (record.priority !== undefined && record.priority !== null) {
      item.priority = record.priority;
    }
    return item;
  }

  function toRegistryRecord(
    domainName: string,
    item: SpaceshipDnsItem,
  ): RegistryDnsRecord {
    const type = String(item.type ?? "").toUpperCase();
    const name = String(item.name ?? "@");
    const ttl = typeof item.ttl === "number" ? item.ttl : 3600;
    const priority = typeof item.priority === "number" ? item.priority : null;
    const value = extractAnswer(item);
    return {
      id: encodeRecordId({ type, name, value, ttl, priority }),
      type,
      host: name,
      fqdn: fqdnOf(name, domainName),
      answer: value,
      ttl,
      priority,
    };
  }

  async function getDomain(domainName: string): Promise<RegistryDomain> {
    const info = await request<SpaceshipDomainInfo>(
      `/v1/domains/${encodeURIComponent(domainName)}`,
    );
    return {
      domainName: info.name ?? domainName,
      nameservers: info.nameservers?.hosts ?? [],
      privacyEnabled: (info.privacyProtection?.level ?? "high") !== "public",
      locked: (info.eppStatuses ?? []).includes("clientTransferProhibited"),
      autorenewEnabled: Boolean(info.autoRenew),
      expireDate: info.expirationDate ?? "",
      createDate: info.registrationDate ?? "",
      renewalPrice: 0,
    };
  }

  function deleteMatchPayload(old: {
    type: string;
    name: string;
    value: string;
    priority: number | null;
  }): SpaceshipDnsItem {
    return {
      type: old.type,
      name: old.name,
      [valueKeyForType(old.type)]: old.value,
      ...(old.priority !== null ? { priority: old.priority } : {}),
    };
  }

  async function saveDnsRecord(
    domainName: string,
    record: NewDnsRecord,
  ): Promise<RegistryDnsRecord> {
    const item = toSpaceshipDnsItem(record);
    await request(`/v1/dns/records/${encodeURIComponent(domainName)}`, {
      method: "PUT",
      body: { force: true, items: [item] },
    });
    return toRegistryRecord(domainName, item);
  }

  return {
    async search(
      keyword: string,
      tldFilter?: string[],
      _timeoutMs = 2000,
    ): Promise<{ results: RegistrySearchResult[] }> {
      const tlds =
        tldFilter && tldFilter.length > 0 ? tldFilter : ["com", "net", "org"];
      const domains = tlds.map((tld) => `${keyword}.${tld.replace(/^\./, "")}`);
      const results: RegistrySearchResult[] = [];
      for (const batch of chunk(domains, 20)) {
        results.push(...(await checkAvailabilityBatch(batch)));
      }
      return { results };
    },

    async checkAvailability(domainNames: string[]): Promise<{
      results: RegistrySearchResult[];
    }> {
      const results: RegistrySearchResult[] = [];
      for (const batch of chunk(domainNames, 20)) {
        results.push(...(await checkAvailabilityBatch(batch)));
      }
      return { results };
    },

    async createContact(input: RegistryContactInput): Promise<{ contactId: string }> {
      const data = await request<{ contactId?: string }>("/v1/contacts", {
        method: "PUT",
        body: input,
      });
      if (!data?.contactId) {
        throw new RegistryError("registry did not return a contact id", 502, true);
      }
      return { contactId: data.contactId };
    },

    async createDomain(input: {
      domainName: string;
      purchasePrice: number;
      purchaseType: string;
      years: number;
      registrantContactId?: string;
    }): Promise<{ domain: { domainName: string }; order: string; totalPaid: number }> {
      const contactId = input.registrantContactId ?? cfg.registrantContactId;
      if (!contactId) {
        throw new RegistryError(
          "no registrant contact id (order did not provide one and SPACESHIP_REGISTRANT_CONTACT_ID is unset)",
          422,
          false,
        );
      }
      const { status, headers } = await requestRaw(
        `/v1/domains/${encodeURIComponent(input.domainName)}`,
        {
          method: "POST",
          body: {
            autoRenew: true,
            years: input.years,
            // required: without these the async registration fails silently
            purchasePrice: input.purchasePrice,
            purchaseType: input.purchaseType,
            privacyProtection: { level: "high", userConsent: true },
            contacts: {
              registrant: contactId,
              admin: contactId,
              tech: contactId,
              billing: contactId,
            },
          },
        },
      );

      let opId = status === 202 ? headers.get("spaceship-async-operationid") : null;
      if (!opId) {
        return {
          domain: { domainName: input.domainName },
          order: "",
          totalPaid: input.purchasePrice * input.years,
        };
      }
      const operationId: string = opId;

      for (let i = 0; i < REGISTER_POLL_MAX_TRIES; i++) {
        await sleep(REGISTER_POLL_INTERVAL_MS);
        const op = await request<SpaceshipAsyncOperation | undefined>(
          `/v1/async-operations/${encodeURIComponent(operationId)}`,
        ).catch(() => undefined);
        if (!op) continue;
        if (op.status === "success") {
          return {
            domain: { domainName: input.domainName },
            order: operationId,
            totalPaid: input.purchasePrice * input.years,
          };
        }
        if (op.status === "failed") {
          throw new RegistryError(
            `registry registration failed for ${input.domainName}: ${JSON.stringify(op).slice(0, 300)}`,
            502,
            false,
          );
        }
      }
      throw new RegistryError(
        `registry registration still pending for ${input.domainName}`,
        504,
        false,
      );
    },

    async listDnsRecords(domainName: string): Promise<{
      records: RegistryDnsRecord[];
    }> {
      const data = await request<{ items?: SpaceshipDnsItem[]; total?: number }>(
        `/v1/dns/records/${encodeURIComponent(domainName)}?take=500&skip=0`,
      );
      return { records: (data.items ?? []).map((i) => toRegistryRecord(domainName, i)) };
    },

    async createDnsRecord(
      domainName: string,
      record: NewDnsRecord,
    ): Promise<{ record: RegistryDnsRecord }> {
      return { record: await saveDnsRecord(domainName, record) };
    },

    async updateDnsRecord(
      domainName: string,
      recordId: string,
      record: NewDnsRecord,
    ): Promise<{ record: RegistryDnsRecord }> {
      const old = decodeRecordId(recordId);
      await request(`/v1/dns/records/${encodeURIComponent(domainName)}`, {
        method: "DELETE",
        body: [deleteMatchPayload(old)],
      });
      return { record: await saveDnsRecord(domainName, record) };
    },

    async deleteDnsRecord(
      domainName: string,
      recordId: string,
    ): Promise<undefined> {
      const old = decodeRecordId(recordId);
      await request(`/v1/dns/records/${encodeURIComponent(domainName)}`, {
        method: "DELETE",
        body: [deleteMatchPayload(old)],
      });
      return undefined;
    },

    getDomain,

    async getPricing(domainName: string): Promise<RegistryDomainPricing> {
      const data = await request<SpaceshipAvailability>(
        `/v1/domains/${encodeURIComponent(domainName)}/available`,
      );
      const register =
        data.premiumPricing?.find((p) => p.operation === "register") ??
        data.premiumPricing?.[0];
      const dot = domainName.lastIndexOf(".");
      const tld = dot > 0 ? domainName.slice(dot + 1) : "";
      const catalogPrice = cfg.tldPrices?.[tld] ?? cfg.defaultTldPrice ?? 0;
      const price = register?.price ?? catalogPrice;
      return {
        purchasePrice: price,
        renewalPrice: price,
        transferPrice: price,
        premium: Boolean(register),
      };
    },

    async setAutorenew(
      domainName: string,
      enabled: boolean,
    ): Promise<RegistryDomain> {
      await request(`/v1/domains/${encodeURIComponent(domainName)}/autorenew`, {
        method: "PUT",
        body: { isEnabled: enabled },
      });
      return getDomain(domainName);
    },

    async setPrivacy(
      domainName: string,
      enabled: boolean,
    ): Promise<RegistryDomain> {
      await request(
        `/v1/domains/${encodeURIComponent(domainName)}/privacy/preference`,
        {
          method: "PUT",
          body: { privacyLevel: enabled ? "high" : "public", userConsent: true },
        },
      );
      return getDomain(domainName);
    },

    async setNameservers(
      domainName: string,
      nameservers: string[],
    ): Promise<RegistryDomain> {
      await request(
        `/v1/domains/${encodeURIComponent(domainName)}/nameservers`,
        {
          method: "PUT",
          body: { provider: "custom", hosts: nameservers },
        },
      );
      return getDomain(domainName);
    },

    async setLock(
      domainName: string,
      locked: boolean,
    ): Promise<RegistryDomain> {
      await request(
        `/v1/domains/${encodeURIComponent(domainName)}/transfer/lock`,
        { method: "PUT", body: { isLocked: locked } },
      );
      return getDomain(domainName);
    },
  };
}
