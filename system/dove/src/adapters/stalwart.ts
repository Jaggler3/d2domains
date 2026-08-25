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
  methodResponses?: [string, Record<string, unknown>, string][];
  error?: { type?: string; status?: number; detail?: string };
}

/**
 * Thin management client for Stalwart Mail Server (v0.12+, `urn:stalwart:jmap`).
 * Talks to POST /jmap. Auth prefers an API key when configured and falls back
 * to HTTP Basic with the admin credentials (fine for bootstrap/dev).
 */
export function createStalwartClient(config: StalwartConfig) {
  let apiKey = config.apiKey;

  async function call(method: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    } else {
      headers.Authorization = `Basic ${btoa(`${config.adminUser}:${config.adminPassword}`)}`;
    }
    const payload: JmapRequest = {
      using: ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"],
      methodCalls: [[method, args, "c1"]],
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
    if (!res.ok) {
      throw new HttpError(`stalwart error ${res.status}`, 502);
    }
    const data = (await res.json().catch(() => null)) as JmapResponse | null;
    const resp = data?.methodResponses?.[0];
    if (!resp) {
      throw new HttpError(data?.error?.detail ?? "stalwart bad response", 502);
    }
    return resp[1];
  }

  return { call };
}

export type StalwartClient = ReturnType<typeof createStalwartClient>;