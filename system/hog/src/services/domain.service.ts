import { redis, enqueueSearchLog } from "./queue";
import { createRegistryClient, type RegistrySearchResult } from "../adapters/namecom";
import { HttpError } from "../lib/http";
import { loadEnv } from "../config/env";

const env = loadEnv();

const registry = createRegistryClient({
  baseUrl: env.NAME_COM_BASE,
  username: env.NAME_COM_USERNAME,
  token: env.NAME_COM_TOKEN,
});

export interface DomainSearchInput {
  keyword: string;
  tldFilter?: string[];
}

export async function searchDomains(
  input: DomainSearchInput,
  userId: string,
): Promise<RegistrySearchResult[]> {
  const keyword = input.keyword.trim().toLowerCase();
  if (!keyword) throw new HttpError("keyword is required", 422);

  const tlds = (input.tldFilter ?? []).map((t) => t.replace(/^\./, "").toLowerCase());
  const cacheKey = `domain:search:${keyword}:${tlds.join(",") || "any"}`;

  const cached = await redis.get(cacheKey);
  if (cached) {
    const results = JSON.parse(cached) as RegistrySearchResult[];
    void enqueueSearchLog({ userId, keyword, resultCount: results.length, cached: true });
    return results;
  }

  let results: RegistrySearchResult[];
  try {
    const raw = await registry.search(keyword, tlds);
    results = raw.results;
  } catch (err) {
    if (err instanceof Error && err.message.includes("circuit breaker")) {
      throw new HttpError("domain registry is temporarily unavailable", 503);
    }
    throw new HttpError("failed to search domains", 502);
  }

  await redis.set(cacheKey, JSON.stringify(results), "EX", env.SEARCH_CACHE_TTL_SECONDS);
  void enqueueSearchLog({ userId, keyword, resultCount: results.length, cached: false });

  return results;
}
