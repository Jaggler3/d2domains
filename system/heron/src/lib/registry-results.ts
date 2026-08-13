import type { RegistrySearchResult } from "../adapters/namecom";

export interface DomainSearchResult {
  domainName: string;
  sld: string;
  tld: string;
  purchasable: boolean;
  premium: boolean;
  purchasePrice: number | null;
  purchaseType: string;
  renewalPrice: number | null;
}

export function normalizeRegistryResults(
  results: RegistrySearchResult[],
): DomainSearchResult[] {
  return results.map((r) => {
    const domainName = r.domainName;
    const dot = domainName.lastIndexOf(".");
    const sld = r.sld ?? (dot > 0 ? domainName.slice(0, dot) : domainName);
    const tld = r.tld ?? (dot > 0 ? domainName.slice(dot + 1) : "");
    const purchasable = r.purchasable ?? false;
    return {
      domainName,
      sld,
      tld,
      purchasable,
      premium: r.premium ?? false,
      purchasePrice: r.purchasePrice ?? null,
      purchaseType: r.purchaseType ?? (purchasable ? "registration" : "unavailable"),
      renewalPrice: r.renewalPrice ?? null,
    };
  });
}
