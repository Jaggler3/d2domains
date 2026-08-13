"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

interface DnsRecord {
  id: string;
  type: string;
  name: string;
  value: string;
  ttl: number;
  priority: number | null;
  syncStatus: string;
  syncError: string | null;
}

const TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "CAA"];

function SyncBadge({ status, error }: { status: string; error: string | null }) {
  if (status === "synced") {
    return <Badge variant="outline" className="rounded-full text-[10px]">live</Badge>;
  }
  if (status === "error") {
    return (
      <Badge
        variant="outline"
        title={error ?? undefined}
        className="rounded-full border-destructive/40 text-[10px] text-destructive"
      >
        error
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="rounded-full border-primary/40 text-[10px] text-primary"
    >
      {status === "deleting" ? "deleting…" : "syncing…"}
    </Badge>
  );
}

export function DnsManager({ domainName }: { domainName: string }) {
  const [records, setRecords] = useState<DnsRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [mutating, setMutating] = useState(false);

  const [type, setType] = useState("A");
  const [name, setName] = useState("@");
  const [value, setValue] = useState("");
  const [ttl, setTtl] = useState("3600");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/domains/${encodeURIComponent(domainName)}/dns`);
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      const data = (await res.json().catch(() => null)) as {
        records?: DnsRecord[];
        error?: string;
      } | null;
      if (!res.ok) throw new Error(data?.error ?? "failed to load dns");
      setRecords(data?.records ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load dns");
    }
  }, [domainName]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/domains/${encodeURIComponent(domainName)}/dns`)
      .then(async (res) => {
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        const data = (await res.json().catch(() => null)) as {
          records?: DnsRecord[];
          error?: string;
        } | null;
        if (!res.ok) throw new Error(data?.error ?? "failed to load dns");
        if (!cancelled) {
          setRecords(data?.records ?? []);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "failed to load dns");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [domainName]);

  useEffect(() => {
    if (!records) return;
    const hasPending = records.some((r) => r.syncStatus !== "synced");
    if (!hasPending) return;
    const id = setInterval(() => {
      void load();
    }, 2000);
    return () => clearInterval(id);
  }, [records, load]);

  async function addRecord(e: React.FormEvent) {
    e.preventDefault();
    setMutating(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/domains/${encodeURIComponent(domainName)}/dns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, name: name.trim(), value: value.trim(), ttl: Number(ttl) }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? "failed to add record");
      setValue("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to add record");
    } finally {
      setMutating(false);
    }
  }

  async function removeRecord(id: string) {
    setMutating(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/domains/${encodeURIComponent(domainName)}/dns/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("failed to delete record");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to delete record");
    } finally {
      setMutating(false);
    }
  }

  if (notFound) {
    return (
      <p className="text-sm text-muted-foreground">
        you don&apos;t own {domainName}, or it doesn&apos;t exist.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="flex flex-col gap-4 py-5">
          <h2 className="text-base font-medium lowercase">add a record</h2>
          <form className="flex flex-wrap items-end gap-2" onSubmit={addRecord}>
            <div className="flex flex-col gap-1">
              <Label htmlFor="rec-type">type</Label>
              <select
                id="rec-type"
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="h-8 rounded-md border border-border bg-background px-2 text-sm"
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="rec-name">name</Label>
              <Input
                id="rec-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="@ or www"
                className="h-8 w-32"
                required
              />
            </div>
            <div className="flex min-w-[180px] flex-1 flex-col gap-1">
              <Label htmlFor="rec-value">value</Label>
              <Input
                id="rec-value"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={type === "A" ? "192.0.2.1" : "target or text"}
                className="h-8"
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="rec-ttl">ttl</Label>
              <Input
                id="rec-ttl"
                value={ttl}
                onChange={(e) => setTtl(e.target.value)}
                inputMode="numeric"
                className="h-8 w-20"
                required
              />
            </div>
            <Button type="submit" size="sm" disabled={mutating || !value.trim()}>
              {mutating && <Loader2 className="animate-spin" />}
              <Plus /> add
            </Button>
          </form>
        </CardContent>
      </Card>

      {records === null ? (
        <p className="text-sm text-muted-foreground">loading records…</p>
      ) : records.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          no records yet — add one above.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {records.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="w-16 shrink-0 text-xs font-semibold text-muted-foreground">
                  {r.type}
                </span>
                <span className="truncate font-mono text-sm">
                  {r.name === "@" ? "@" : `${r.name}.${domainName}`}
                </span>
                <span className="hidden truncate text-xs text-muted-foreground sm:block">
                  {r.value}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="hidden text-xs text-muted-foreground md:block">
                  ttl {r.ttl}
                </span>
                <SyncBadge status={r.syncStatus} error={r.syncError} />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="delete record"
                  disabled={mutating}
                  onClick={() => removeRecord(r.id)}
                >
                  <Trash2 />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
