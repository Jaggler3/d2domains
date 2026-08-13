"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { buyDomain } from "@/lib/buy-domain";
import { measureCaretIn, type CaretAnchor } from "@/lib/caret";

interface SearchResult {
  domainName: string;
  purchasable: boolean;
  purchasePrice: number | null;
}

export function DomainSearch({
  hideCaret = false,
  onFocusChange,
  onCaretChange,
  onResultsChange,
}: {
  hideCaret?: boolean;
  onFocusChange?: (focused: boolean) => void;
  onCaretChange?: (anchor: CaretAnchor | null) => void;
  onResultsChange?: (hasResults: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const [result, setResult] = useState<{
    keyword: string;
    items: SearchResult[];
  } | null>(null);

  useEffect(() => {
    const keyword = query.trim();
    if (keyword.length < 2) {
      const id = setTimeout(() => {
        setPending(false);
        setError(null);
        setResult(null);
        onResultsChange?.(false);
      }, 0);
      return () => clearTimeout(id);
    }
    let cancelled = false;
    const id = setTimeout(async () => {
      try {
        const res = await fetch("/api/v1/domains/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keyword }),
        });
        if (res.status === 429) {
          throw new Error("you're searching too fast, take a breather");
        }
        const data = (await res.json().catch(() => null)) as {
          results?: SearchResult[];
          error?: string;
        } | null;
        if (!res.ok) throw new Error(data?.error ?? "search failed");
        if (cancelled) return;
        setResult({ keyword, items: data?.results ?? [] });
        setError(null);
        onResultsChange?.(true);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "search failed");
        setResult(null);
        onResultsChange?.(false);
      } finally {
        if (!cancelled) setPending(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [query, onResultsChange]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value);
    setPending(true);
  }

  async function buy(domainName: string) {
    setBuying(domainName);
    try {
      const result = await buyDomain(domainName);
      if (result.unauthorized) {
        window.localStorage.setItem("pendingBuy", domainName);
        router.push("/login");
        return;
      }
      if (!result.ok) throw new Error(result.error ?? "purchase failed");
      router.push("/account");
    } catch (err) {
      setError(err instanceof Error ? err.message : "purchase failed");
    } finally {
      setBuying(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-3">
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-2 shadow-lg shadow-primary/5 transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/25">
        {pending ? (
          <Loader2 className="ml-2 size-4 shrink-0 animate-spin text-primary" />
        ) : (
          <Search className="ml-2 size-4 shrink-0 text-muted-foreground" />
        )}
        <Input
          id="domain-search-input"
          value={query}
          onChange={handleChange}
          onFocus={(e) => {
            onFocusChange?.(true);
            const el = e.currentTarget;
            window.setTimeout(() => {
              if (document.activeElement === el) {
                onCaretChange?.(measureCaretIn(el));
              }
            }, 0);
          }}
          onBlur={() => {
            onFocusChange?.(false);
            onCaretChange?.(null);
          }}
          onSelect={(e) => onCaretChange?.(measureCaretIn(e.currentTarget))}
          placeholder="search for a domain"
          className={cn(
            "h-9 rounded-none border-0 bg-transparent py-0 leading-9 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0",
            hideCaret && "caret-transparent",
          )}
          aria-label="domain search"
        />
      </div>

      {error && <p className="px-1 text-sm text-destructive">{error}</p>}

      {result && (
        <ul
          className={cn(
            "animate-slide-up divide-y divide-border overflow-x-hidden overflow-y-auto rounded-xl border border-border bg-card shadow-lg shadow-primary/5",
            "max-h-[45vh]",
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
                    {r.purchasePrice != null ? `$${r.purchasePrice.toFixed(2)}` : "available"}
                  </span>
                  <Button
                    size="sm"
                    onClick={() => buy(r.domainName)}
                    disabled={buying !== null}
                  >
                    {buying === r.domainName && <Loader2 className="animate-spin" />}
                    get it
                  </Button>
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
