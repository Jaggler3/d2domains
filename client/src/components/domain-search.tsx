"use client";

import { useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface SearchResult {
  domainName: string;
  purchasable: boolean;
  purchasePrice?: number;
}

const TLD_PRICES: Record<string, number> = {
  com: 11.99,
  net: 13.99,
  org: 9.99,
  io: 45.99,
  dev: 12.99,
  ai: 89.99,
  co: 29.99,
};

const SUFFIXES = ["", "-hub", "-lab", "-studio", "-co", "-app", "-dev", "-site"];

function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 1000) / 1000;
  };
}

function buildTestResults(keyword: string): SearchResult[] {
  const base = keyword
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "");
  if (!base) return [];

  const rand = seeded(base);
  const tlds = Object.keys(TLD_PRICES);

  return SUFFIXES.map((suffix) => {
    const tld = tlds[Math.floor(rand() * tlds.length)];
    const domainName = `${base}${suffix}.${tld}`;
    const purchasable = rand() > 0.3;
    return {
      domainName,
      purchasable,
      purchasePrice: purchasable
        ? TLD_PRICES[tld] + Math.round(rand() * 40) / 10
        : undefined,
    };
  });
}

export function DomainSearch() {
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{
    keyword: string;
    items: SearchResult[];
  } | null>(null);

  useEffect(() => {
    const keyword = query.trim();
    if (keyword.length < 2) {
      const id = setTimeout(() => {
        setPending(false);
        setResult(null);
      }, 0);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => {
      setResult({ keyword, items: buildTestResults(keyword) });
      setPending(false);
    }, 300);
    return () => clearTimeout(id);
  }, [query]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value);
    setPending(true);
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-3">
      <form
        className="flex items-center gap-2 rounded-xl border border-border bg-card p-2 shadow-lg shadow-primary/5 transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/25"
        onSubmit={(e) => e.preventDefault()}
      >
        {pending ? (
          <Loader2 className="ml-2 size-4 shrink-0 animate-spin text-primary" />
        ) : (
          <Search className="ml-2 size-4 shrink-0 text-muted-foreground" />
        )}
        <Input
          value={query}
          onChange={handleChange}
          placeholder="search for a domain"
          className="border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          aria-label="domain search"
        />
        <Button type="submit" size="lg" disabled={!query.trim()}>
          search
        </Button>
      </form>

      {result && (
        <ul
          className={cn(
            "animate-slide-up divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-lg shadow-primary/5",
            pending && "pointer-events-none opacity-60",
          )}
        >
          {result.items.length === 0 && (
            <li className="px-4 py-3 text-sm text-muted-foreground">
              no matches for that
            </li>
          )}
          {result.items.map((r, i) => (
            <li
              key={r.domainName}
              className="flex animate-fade-in items-center justify-between gap-4 px-4 py-3"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <span className="truncate font-mono text-sm">{r.domainName}</span>
              {r.purchasable ? (
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-sm font-medium">
                    ${r.purchasePrice?.toFixed(2)}
                  </span>
                  <Button size="sm">get it</Button>
                </span>
              ) : (
                <span className="shrink-0 text-xs text-muted-foreground">
                  taken
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
