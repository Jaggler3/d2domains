import { HttpError } from "../lib/http";

export interface StalwartConfig {
  url: string;
  adminUser: string;
  adminPassword: string;
  apiKey?: string;
}

interface JmapRequest {
  using: string[];
  methodCalls: [string, Record<string, unknown>, string][];
}

interface JmapResponse {
  methodResponses?: [string, Record<string, unknown>, ...string[]][];
  error?: { type?: string; status?: number; detail?: string };
}

const JMAP_USING = ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Management client for Stalwart Mail Server v0.12+ (`urn:stalwart:jmap`
 * capability over POST /jmap). Auth prefers an API key when configured and
 * falls back to HTTP Basic with the admin credentials.
 */
export function createStalwartClient(config: StalwartConfig) {
  let apiKey = config.apiKey;

  async function rawCall(
    method: string,
    args: Record<string, unknown>,
  ): Promise<{ name: string; args: Record<string, unknown> }> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    } else {
      headers.Authorization = `Basic ${btoa(`${config.adminUser}:${config.adminPassword}`)}`;
    }
    const payload: JmapRequest = {
      using: JMAP_USING,
      methodCalls: [[method, args, "c0"]],
    };
    let res: Response;
    try {
      res = await fetch(`${config.url}/jmap`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
    } catch {
      throw new HttpError("stalwart unavailable", 503);
    }
    if (!res.ok && res.status !== 400) {
      throw new HttpError(`stalwart error ${res.status}`, 502);
    }
    const data = (await res.json().catch(() => null)) as JmapResponse | null;
    const resp = data?.methodResponses?.[0];
    if (!resp || !isRecord(resp[1])) {
      throw new HttpError(data?.error?.detail ?? "stalwart bad response", 502);
    }
    return { name: resp[0], args: resp[1] };
  }

  /** JMAP invocation that throws on error responses. */
  async function call(method: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { name, args: result } = await rawCall(method, args);
    if (name === "error") {
      const type = typeof result.type === "string" ? result.type : "error";
      const detail = typeof result.description === "string" ? result.description : type;
      throw new HttpError(`stalwart ${method} failed: ${detail}`, 502);
    }
    return result;
  }

  /**
   * Returns true when the server is in bootstrap mode (setup not completed).
   * Bootstrap-mode servers reject every object except Bootstrap.
   */
  async function isInBootstrapMode(): Promise<boolean> {
    const { name, args: result } = await rawCall("x:Domain/query", { filter: null });
    if (name !== "error") return false;
    const detail = String(result.description ?? "");
    return detail.toLowerCase().includes("bootstrap");
  }

  interface DomainBootstrapPayload {
    serverHostname: string;
    defaultDomain: string;
    requestTlsCertificate: boolean;
    generateDkimKeys: boolean;
    directory: Record<string, unknown>;
  }

  /** Completes the setup wizard. Only valid while in bootstrap mode. */
  async function completeBootstrap(payload: DomainBootstrapPayload): Promise<void> {
    await call("x:Bootstrap/set", {
      update: { singleton: payload },
    });
  }

  function sqlDirectoryPayload(opts: {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
  }): Record<string, unknown> {
    return {
      "@type": "Sql",
      description: `d2domains accounts (${opts.database})`,
      store: {
        "@type": "PostgreSql",
        host: opts.host,
        port: opts.port,
        database: opts.database,
        authUsername: opts.username,
        authSecret: { "@type": "Value", secret: opts.password },
      },
    };
  }

  async function listDomains(): Promise<{ id: string; name: string }[]> {
    const q = await call("x:Domain/query", { filter: null });
    const ids = (q.ids as string[] | undefined) ?? [];
    if (ids.length === 0) return [];
    const g = await call("x:Domain/get", { ids });
    const list = (g.list as Record<string, unknown>[] | undefined) ?? [];
    return list
      .filter((d) => typeof d.id === "string" && typeof d.name === "string")
      .map((d) => ({ id: d.id as string, name: d.name as string }));
  }

  /** Finds the domain in Stalwart, creating it (with auto-DKIM) if missing. */
  async function ensureDomain(name: string): Promise<{ id: string }> {
    const existing = (await listDomains()).find((d) => d.name === name.toLowerCase());
    if (existing) return { id: existing.id };

    const created = await call("x:Domain/set", {
      create: { d: { name: name.toLowerCase() } },
    });
    const entry = (created.created as Record<string, unknown> | undefined)?.d;
    const id = isRecord(entry) ? entry.id : undefined;
    if (typeof id !== "string") {
      throw new HttpError(`stalwart did not return an id for domain ${name}`, 502);
    }
    return { id };
  }

  interface DkimInfo {
    selector: string;
    publicKey: string;
  }

  /** Returns the active DKIM signature for a domain (RSA preferred for DNS compat). */
  async function getActiveDkim(domainId: string): Promise<DkimInfo | null> {
    const q = await call("x:DkimSignature/query", { filter: null });
    const ids = (q.ids as string[] | undefined) ?? [];
    if (ids.length === 0) return null;
    const g = await call("x:DkimSignature/get", { ids });
    const list = (g.list as Record<string, unknown>[] | undefined) ?? [];
    const forDomain = list.filter(
      (s) => s.domainId === domainId && s.stage === "active",
    );
    const rsa = forDomain.find((s) => String(s["@type"]).includes("Rsa"));
    const pick = rsa ?? forDomain[0];
    if (!pick) return null;
    if (typeof pick.selector !== "string" || typeof pick.publicKey !== "string") {
      return null;
    }
    return { selector: pick.selector, publicKey: pick.publicKey };
  }

  async function getAuthenticationDirectoryId(): Promise<string | null> {
    const g = await call("x:Authentication/get", { ids: ["singleton"] });
    const singleton = (g.list as Record<string,unknown>[] | undefined)?.[0];
    if (!isRecord(singleton)) return null;
    return typeof singleton.directoryId === "string" ? singleton.directoryId : null;
  }

  async function setAuthenticationDirectoryId(directoryId: string): Promise<void> {
    await call("x:Authentication/set", {
      update: { singleton: { directoryId } },
    });
    // Directory backends are compiled into the settings snapshot — a reload
    // action is required before the binding takes effect.
    await call("x:Action/set", {
      create: { r: { "@type": "ReloadSettings" } },
    });
  }

  async function findSqlDirectory(database: string): Promise<{ id: string } | null> {
    const q = await call("x:Directory/query", { filter: null });
    const ids = (q.ids as string[] | undefined) ?? [];
    if (ids.length === 0) return null;
    const g = await call("x:Directory/get", { ids });
    const list = (g.list as Record<string, unknown>[] | undefined) ?? [];
    const match = list.find((d) => {
      if (d["@type"] !== "Sql" || !isRecord(d.store)) return false;
      return d.store.database === database;
    });
    return match && typeof match.id === "string" ? { id: match.id } : null;
  }

  async function createSqlDirectory(payload: Record<string, unknown>): Promise<{ id: string }> {
    const created = await call("x:Directory/set", { create: { d: payload } });
    const entry = (created.created as Record<string, unknown> | undefined)?.d;
    const id = isRecord(entry) ? entry.id : undefined;
    if (typeof id !== "string") {
      throw new HttpError("stalwart did not return an id for the directory", 502);
    }
    return { id };
  }

  return {
    call,
    isInBootstrapMode,
    completeBootstrap,
    sqlDirectoryPayload,
    ensureDomain,
    getActiveDkim,
    getAuthenticationDirectoryId,
    setAuthenticationDirectoryId,
    findSqlDirectory,
    createSqlDirectory,
  };
}

export type StalwartClient = ReturnType<typeof createStalwartClient>;
