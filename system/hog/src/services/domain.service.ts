import { redis, enqueueSearchLog } from "./queue";
import { createRegistryClient, type DomainSearchResult } from "../adapters/registry";
import { HttpError } from "../lib/http";
import { loadEnv } from "../config/env";

const env = loadEnv();

const registry = createRegistryClient({ baseUrl: env.REGISTRY_URL, internalToken: env.INTERNAL_TOKEN });

export interface DomainSearchInput {
  keyword: string;
  tldFilter?: string[];
}

export async function searchDomains(
  input: DomainSearchInput,
  userId: string,
): Promise<DomainSearchResult[]> {
  const keyword = input.keyword.trim().toLowerCase();
  if (!keyword) throw new HttpError("keyword is required", 422);

  const tlds = (input.tldFilter ?? []).map((t) => t.replace(/^\./, "").toLowerCase());
  const cacheKey = `domain:search:${keyword}:${tlds.join(",") || "any"}`;

  const cached = await redis.get(cacheKey);
  if (cached) {
    const results = JSON.parse(cached) as DomainSearchResult[];
    void enqueueSearchLog({ userId, keyword, resultCount: results.length, cached: true });
    return results;
  }

  let results: DomainSearchResult[];
  try {
    const res = await registry.search(keyword, tlds);
    results = res.results;
  } catch (err) {
    if (err instanceof HttpError && err.status === 429) {
      throw new HttpError("search rate limit exceeded, try again shortly", 429);
    }
    throw new HttpError("failed to search domains", 502);
  }

  await redis.set(cacheKey, JSON.stringify(results), "EX", env.SEARCH_CACHE_TTL_SECONDS);
  void enqueueSearchLog({ userId, keyword, resultCount: results.length, cached: false });

  return results;
}
