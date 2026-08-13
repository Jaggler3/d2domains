import { createWeaselClient } from "../adapters/weasel";
import { HttpError } from "../lib/http";
import { loadEnv } from "../config/env";

const weasel = createWeaselClient({ baseUrl: loadEnv().WEASEL_URL });

export async function assertDomainOwnership(
  userId: string,
  domainName: string,
): Promise<void> {
  try {
    await weasel.getDomain(domainName, userId);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      throw new HttpError("domain not found", 404);
    }
    throw err;
  }
}
