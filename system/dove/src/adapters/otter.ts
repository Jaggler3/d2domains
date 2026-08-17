import { HttpError } from "../lib/http";

export interface OtterRecordInput {
  type: string;
  name: string;
  value: string;
  ttl?: number;
  priority?: number | null;
}

export function createOtterClient(config: { baseUrl: string; internalToken: string }) {
  async function createRecord(domainName: string, userId: string, input: OtterRecordInput) {
    let res: Response;
    try {
      res = await fetch(
        `${config.baseUrl}/v1/zones/${encodeURIComponent(domainName)}/records?userId=${encodeURIComponent(userId)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-token": config.internalToken,
          },
          body: JSON.stringify(input),
        },
      );
    } catch {
      throw new HttpError("otter unavailable", 503);
    }
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok && res.status !== 409) {
      throw new HttpError(data?.error ?? "otter error", res.status);
    }
  }

  return { createRecord };
}