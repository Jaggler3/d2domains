import type { Metadata } from "next";
import Link from "next/link";
import { Globe, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getMyDomains, getMyOrders } from "@/lib/session";

export const metadata: Metadata = {
  title: "dashboard",
};

export default async function DashboardPage() {
  const [domains, orders] = await Promise.all([getMyDomains(), getMyOrders()]);

  const pending = orders.filter((o) => o.status === "pending");
  const failed = orders.filter((o) => o.status === "failed");
  const hasAny = domains.length > 0 || pending.length > 0 || failed.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight lowercase">
          your domains
        </h1>
        <p className="text-sm text-muted-foreground">
          everything you&apos;ve claimed so far.
        </p>
      </div>

      {!hasAny ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="inline-flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Globe className="size-6" />
            </div>
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-medium lowercase">no domains yet</h2>
              <p className="max-w-sm text-sm text-muted-foreground">
                search for your next domain and claim it before someone else
                does.
              </p>
            </div>
            <Button render={<Link href="/">search for a domain</Link>} />
          </CardContent>
        </Card>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {pending.map((o) => (
            <li
              key={o.id}
              className="flex items-center justify-between gap-4 px-4 py-4"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
                <span className="truncate font-mono text-sm">
                  {o.domainName}
                </span>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                registering…
              </span>
            </li>
          ))}

          {failed.map((o) => (
            <li
              key={o.id}
              className="flex items-center justify-between gap-4 px-4 py-4"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="truncate font-mono text-sm">
                  {o.domainName}
                </span>
                <Badge
                  variant="outline"
                  className="shrink-0 rounded-full border-destructive/40 text-[10px] text-destructive"
                >
                  failed
                </Badge>
              </div>
              <span className="shrink-0 truncate text-xs text-muted-foreground">
                {o.error ?? "purchase failed"}
              </span>
            </li>
          ))}

          {domains.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-4 px-4 py-4"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="truncate font-mono text-sm">
                  {d.domainName}
                </span>
                <Badge variant="outline" className="rounded-full text-[10px]">
                  {d.status}
                </Badge>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                expires {new Date(d.expiresAt).getUTCFullYear()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
