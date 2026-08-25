"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Key, Loader2, Mail, Server, Trash2 } from "lucide-react";

interface MailboxCredential {
  address: string;
  password: string;
}

interface DomainMailbox {
  address: string;
  password: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  mailboxes?: MailboxCredential[];
}

const EMAIL_PRICE_PER_YEAR = "$29.99";

type Phase =
  | { state: "loading" }
  | { state: "none" }
  | { state: "active"; data: DomainMailbox }
  | { state: "provisioning" }
  | { state: "removing" };

export function EmailManager({ domainName }: { domainName: string }) {
  const [phase, setPhase] = useState<Phase>({ state: "loading" });
  const [mailboxes, setMailboxes] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const load = useCallback(async (): Promise<boolean> => {
    const res = await fetch(`/api/v1/domains/${encodeURIComponent(domainName)}/email`);
    if (res.status === 404) return false;
    if (!res.ok) throw new Error("failed to load email status");
    const data = (await res.json()) as DomainMailbox;
    setPhase({ state: "active", data });
    return true;
  }, [domainName]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/domains/${encodeURIComponent(domainName)}/email`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) {
          setPhase({ state: "none" });
          return;
        }
        if (!res.ok) throw new Error("failed to load email status");
        const data = (await res.json()) as DomainMailbox;
        setPhase({ state: "active", data });
      })
      .catch(() => {
        if (!cancelled) setPhase({ state: "none" });
      });
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [domainName]);

  async function addEmail(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch(`/api/v1/domains/${encodeURIComponent(domainName)}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "starter", mailboxes }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok && res.status !== 202) {
        throw new Error(data?.error ?? "failed to add email");
      }
      setPhase({ state: "provisioning" });
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          if (await load()) stopPolling();
        } catch {
          /* keep polling */
        }
      }, 3_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to add email");
    }
  }

  async function removeEmail() {
    setError(null);
    try {
      const res = await fetch(`/api/v1/domains/${encodeURIComponent(domainName)}/email`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? "failed to remove email");
      setConfirmingRemove(false);
      setPhase({ state: "removing" });
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const found = await load();
          if (!found) {
            stopPolling();
            setPhase({ state: "none" });
          }
        } catch {
          /* keep polling */
        }
      }, 3_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to remove email");
    }
  }

  if (phase.state === "loading") {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> loading email…
        </CardContent>
      </Card>
    );
  }

  if (phase.state === "provisioning") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" /> Email
          </CardTitle>
          <CardDescription className="flex items-center gap-2">
            <Loader2 className="size-3 animate-spin" />
            provisioning your mailboxes — this can take up to a minute.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (phase.state === "removing") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" /> Email
          </CardTitle>
          <CardDescription className="flex items-center gap-2">
            <Loader2 className="size-3 animate-spin" />
            removing mailboxes and dns records…
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (phase.state === "none") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Email
          </CardTitle>
          <CardDescription>
            add mailboxes at {domainName} — {EMAIL_PRICE_PER_YEAR} per mailbox per year,
            charged now. remove any time (no partial refunds).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={addEmail} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex flex-col gap-1">
              <Label htmlFor="mailbox-count">mailboxes</Label>
              <Input
                id="mailbox-count"
                type="number"
                min={1}
                max={100}
                value={mailboxes}
                onChange={(e) => setMailboxes(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                className="w-24"
              />
              <p className="text-xs text-muted-foreground">
                admin@{domainName}, user2@{domainName}, …
              </p>
            </div>
            <Button type="submit">add email — {EMAIL_PRICE_PER_YEAR}/yr each</Button>
          </form>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    );
  }

  const { data } = phase;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          Email
        </CardTitle>
        <CardDescription>
          your mailboxes are ready. use these details in your email client.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {(data.mailboxes ?? [
          { address: data.address, password: data.password },
        ]).map((m) => (
          <div key={m.address} className="grid gap-2 rounded-lg border bg-muted/40 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Server className="size-4 text-muted-foreground" />
                <span className="font-mono text-sm">{m.address}</span>
              </div>
              <span className="font-mono text-sm text-muted-foreground">
                <Key className="mr-1 inline size-3.5" />
                {m.password}
              </span>
            </div>
            <p className="font-mono text-xs text-muted-foreground">
              IMAP {data.imapHost}:{data.imapPort} · SMTP {data.smtpHost}:{data.smtpPort}
            </p>
          </div>
        ))}

        {confirmingRemove ? (
          <div className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <p className="text-sm">
              remove all mailboxes at {domainName}? addresses stop receiving mail
              immediately; no refund is issued for the current term.
            </p>
            <div className="flex gap-2">
              <Button variant="destructive" size="sm" onClick={removeEmail}>
                yes, remove email
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmingRemove(false)}>
                cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="self-start text-destructive hover:text-destructive"
            onClick={() => setConfirmingRemove(true)}
          >
            <Trash2 /> remove email
          </Button>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
