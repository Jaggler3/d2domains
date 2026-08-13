"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SearchResult {
  domainName: string;
  purchasable?: boolean;
  purchasePrice?: number;
  purchaseType?: string;
}

export function DomainSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[] | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const keyword = query.trim();
    if (!keyword) return;
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch("/api/v1/domains/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword }),
      });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      const data = (await res.json().catch(() => null)) as {
        results?: SearchResult[];
        error?: string;
      } | null;
      if (!res.ok) {
        throw new Error(data?.error ?? "search failed");
      }
      setResults(data?.results ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "search failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <form
        className="flex items-center gap-2 rounded-xl border border-border bg-card p-2 shadow-lg shadow-primary/5"
        onSubmit={onSubmit}
      >
        <Search className="ml-2 size-4 shrink-0 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="search for a domain"
          className="border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          aria-label="domain search"
          disabled={loading}
        />
        <Button type="submit" size="lg" disabled={loading || !query.trim()}>
          {loading && <Loader2 className="animate-spin" />}
          search
        </Button>
      </form>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {results && (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {results.map((r) => (
            <li
              key={r.domainName}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <span className="font-mono text-sm">{r.domainName}</span>
              {r.purchasable ? (
                <span className="flex items-center gap-3">
                  <span className="text-sm font-medium">
                    {r.purchasePrice ? `$${r.purchasePrice.toFixed(2)}` : "available"}
                  </span>
                  <Button size="sm">get it</Button>
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">taken</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
