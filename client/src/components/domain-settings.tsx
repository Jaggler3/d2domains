"use client";

import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

interface DomainSettings {
  domainName: string;
  nameservers: string[];
  privacyEnabled: boolean;
  locked: boolean;
  autorenewEnabled: boolean;
  expireDate: string;
  createDate: string;
  renewalPrice: number;
  contacts?: {
    registrant?: {
      firstName?: string;
      lastName?: string;
      organization?: string;
      email?: string;
      phone?: string;
      country?: string;
    };
  };
}

function Toggle({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="flex items-center gap-2">
        <span className="text-sm">{label}</span>
        {value ? (
          <Badge variant="outline" className="rounded-full text-[10px]">on</Badge>
        ) : (
          <Badge variant="outline" className="rounded-full text-[10px] text-muted-foreground">off</Badge>
        )}
      </div>
      <Button variant="outline" size="xs" onClick={onChange} disabled={disabled}>
        turn {value ? "off" : "on"}
      </Button>
    </div>
  );
}

export function DomainSettings({ domainName }: { domainName: string }) {
  const [settings, setSettings] = useState<DomainSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nameservers, setNameservers] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/domains/${encodeURIComponent(domainName)}/settings`)
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as {
          domain?: DomainSettings;
          error?: string;
        } | null;
        if (!res.ok) throw new Error(data?.error ?? "failed to load settings");
        if (!cancelled) {
          setSettings(data?.domain ?? null);
          setNameservers((data?.domain?.nameservers ?? []).join(", "));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "failed to load settings");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [domainName]);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/domains/${encodeURIComponent(domainName)}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as {
        domain?: DomainSettings;
        error?: string;
      } | null;
      if (!res.ok) throw new Error(data?.error ?? "failed to update settings");
      setSettings(data?.domain ?? null);
      setNameservers((data?.domain?.nameservers ?? []).join(", "));
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to update settings");
    } finally {
      setBusy(false);
    }
  }

  async function saveNameservers() {
    const list = nameservers
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length === 0) {
      setError("enter at least one nameserver");
      return;
    }
    await patch({ nameservers: list });
  }

  if (error && !settings) {
    return <p className="text-sm text-destructive">{error}</p>;
  }
  if (!settings) {
    return <p className="text-sm text-muted-foreground">loading settings…</p>;
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-1 py-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-medium lowercase">registrar settings</h2>
          <span className="text-xs text-muted-foreground">
            renews ${settings.renewalPrice.toFixed(2)} · expires{" "}
            {new Date(settings.expireDate).getUTCFullYear()}
          </span>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="divide-y divide-border">
          <Toggle
            label="autorenew"
            value={settings.autorenewEnabled}
            disabled={busy}
            onChange={() => patch({ autorenew: !settings.autorenewEnabled })}
          />
          <Toggle
            label="whois privacy"
            value={settings.privacyEnabled}
            disabled={busy}
            onChange={() => patch({ privacy: !settings.privacyEnabled })}
          />
          <Toggle
            label="transfer lock"
            value={settings.locked}
            disabled={busy}
            onChange={() => patch({ locked: !settings.locked })}
          />
        </div>

        <div className="flex items-end gap-2 pt-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Label htmlFor="nameservers">nameservers</Label>
            <Input
              id="nameservers"
              value={nameservers}
              onChange={(e) => setNameservers(e.target.value)}
              placeholder="ns1.name.com, ns2.name.com"
              className="h-8"
              disabled={busy}
            />
          </div>
          <Button size="sm" variant="outline" onClick={saveNameservers} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            <Save /> save
          </Button>
        </div>

        {settings.contacts?.registrant && (
          <div className="mt-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-3 text-xs">
            <p className="font-medium lowercase text-muted-foreground">whois · registrant</p>
            <p className="mt-1">
              {[
                settings.contacts.registrant.firstName,
                settings.contacts.registrant.lastName,
              ]
                .filter(Boolean)
                .join(" ") || "—"}
              {settings.contacts.registrant.email
                ? ` · ${settings.contacts.registrant.email}`
                : ""}
            </p>
            <p className="text-muted-foreground">
              registered{" "}
              {new Date(settings.createDate).toLocaleDateString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
