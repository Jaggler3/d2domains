export const DEFAULT_TLDS = [
  "com",
  "net",
  "org",
  "io",
  "dev",
  "co",
  "me",
  "app",
] as const;

export const TLD_PRICES: Record<string, number> = {
  com: 12.99,
  net: 14.49,
  org: 8.99,
  io: 45.99,
  dev: 9.99,
  co: 21.99,
  me: 7.99,
  app: 12.99,
};

export function basePrice(tld: string): number {
  return TLD_PRICES[tld] ?? 10.99;
}

export function djb2(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

export type State = "available" | "premium" | "taken";

/** Deterministic pseudo-random state for (sld, tld). Stable across restarts. */
export function hashState(sld: string, tld: string): State {
  const roll = djb2(`${sld}:${tld}`) % 100;
  if (roll < 70) return "available";
  if (roll < 85) return "premium";
  return "taken";
}

export interface MockSearchResult {
  domainName: string;
  sld: string;
  tld: string;
  purchasable?: boolean;
  premium?: boolean;
  purchasePrice?: number;
  purchaseType?: string;
  renewalPrice?: number;
}

export function searchCandidates(
  keyword: string,
  tlds: string[],
  isTaken: (domain: string) => boolean,
): MockSearchResult[] {
  const sld = keyword.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 63);
  return tlds.map((tld) => {
    const domainName = `${sld}.${tld}`;
    if (isTaken(domainName)) {
      return { domainName, sld, tld };
    }
    const state = hashState(sld, tld);
    if (state === "taken") {
      return { domainName, sld, tld };
    }
    const price = basePrice(tld);
    if (state === "premium") {
      return {
        domainName,
        sld,
        tld,
        purchasable: true,
        premium: true,
        purchasePrice: round2(price * 15),
        purchaseType: "registration",
        renewalPrice: round2(price * 15),
      };
    }
    return {
      domainName,
      sld,
      tld,
      purchasable: true,
      purchasePrice: price,
      purchaseType: "registration",
      renewalPrice: price,
    };
  });
}

export function checkCandidates(
  domainNames: string[],
  isTaken: (domain: string) => boolean,
): MockSearchResult[] {
  const results: MockSearchResult[] = [];
  for (const raw of domainNames) {
    const domainName = raw.toLowerCase();
    const dot = domainName.lastIndexOf(".");
    if (dot <= 0 || dot === domainName.length - 1) continue;
    const sld = domainName.slice(0, dot);
    const tld = domainName.slice(dot + 1);
    const taken = isTaken(domainName) || hashState(sld, tld) === "taken";
    if (taken) {
      results.push({ domainName, sld, tld });
      continue;
    }
    const price = basePrice(tld);
    results.push({
      domainName,
      sld,
      tld,
      purchasable: true,
      purchasePrice: price,
      purchaseType: "registration",
      renewalPrice: price,
    });
  }
  return results;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
