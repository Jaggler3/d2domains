import type { Metadata } from "next";
import Link from "next/link";
import { Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getMyOrders } from "@/lib/session";

export const metadata: Metadata = {
  title: "orders",
};

function statusBadge(status: string) {
  if (status === "purchased") {
    return <Badge variant="outline" className="rounded-full text-[10px]">completed</Badge>;
  }
  if (status === "failed") {
    return (
      <Badge
        variant="outline"
        className="rounded-full border-destructive/40 text-[10px] text-destructive"
      >
        failed
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="rounded-full border-primary/40 text-[10px] text-primary"
    >
      pending
    </Badge>
  );
}

export default async function OrdersPage() {
  const orders = await getMyOrders();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight lowercase">
          orders
        </h1>
        <p className="text-sm text-muted-foreground">
          your purchase history.
        </p>
      </div>

      {orders.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="inline-flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Receipt className="size-6" />
            </div>
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-medium lowercase">no orders yet</h2>
              <p className="max-w-sm text-sm text-muted-foreground">
                when you buy a domain, it&apos;ll show up here.
              </p>
            </div>
            <Button render={<Link href="/">search for a domain</Link>} />
          </CardContent>
        </Card>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {orders.map((o) => (
            <li
              key={o.id}
              className="flex flex-col gap-1 px-4 py-4"
            >
              <div className="flex min-w-0 items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="truncate font-mono text-sm">
                    {o.domainName}
                  </span>
                  {statusBadge(o.status)}
                </div>
                <span className="shrink-0 text-sm font-medium tabular-nums">
                  ${((o.totalCents ?? o.priceCents) / 100).toFixed(2)}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                {new Date(o.createdAt).toLocaleString("en-US", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
                {o.status === "failed" && o.error ? ` · ${o.error}` : ""}
              </span>
              {o.addons && o.addons.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {o.addons.map((a, i) => (
                    <span
                      key={i}
                      className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground"
                    >
                      {a.type} · {a.plan} · ${(a.priceCents / 100).toFixed(2)}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
