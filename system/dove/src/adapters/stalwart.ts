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
 * Thin JMAP management client for Stalwart Mail Server (v0.16+).
 * Talks to POST /jmap with an ApiKey bearer token (created at bootstrap).
 */
export function createStalwartClient(config: StalwartConfig) {
  let apiKey = config.apiKey;

  async function call(method: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!apiKey) {
      throw new HttpError("stalwart api key not configured", 503);
    }
    const payload: JmapRequest = {
      using: ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"],
      methodCalls: [[method, args, "c1"]],
    };
    let res: Response;
    try {
      res = await fetch(`${config.url}/jmap`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
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