"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  addPaymentMethod,
  getPaymentMethods,
  removePaymentMethod,
  setDefaultPaymentMethod,
  type PaymentMethod,
} from "@/lib/checkout";
import type { Order } from "@/lib/session";

const money = (cents: number | null | undefined) =>
  cents == null ? "—" : `$${(cents / 100).toFixed(2)}`;

export function BillingManager({ orders }: { orders: Order[] }) {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddCard, setShowAddCard] = useState(false);
  const [cardBrand, setCardBrand] = useState("Visa");
  const [cardLast4, setCardLast4] = useState("");
  const [cardExpMonth, setCardExpMonth] = useState("");
  const [cardExpYear, setCardExpYear] = useState("");
  const [addingCard, setAddingCard] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshMethods = useCallback(async () => {
    const m = await getPaymentMethods();
    setMethods(m);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getPaymentMethods()
      .then((m) => {
        if (!cancelled) setMethods(m);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function addCard(e: React.FormEvent) {
    e.preventDefault();
    if (cardLast4.length !== 4) {
      setError("last 4 digits are required");
      return;
    }
    setAddingCard(true);
    setError(null);
    const method = await addPaymentMethod({
      brand: cardBrand.trim() || "Visa",
      last4: cardLast4,
      expMonth: cardExpMonth ? Number(cardExpMonth) : null,
      expYear: cardExpYear ? Number(cardExpYear) : null,
    });
    setAddingCard(false);
    if (!method) {
      setError("failed to add card");
      return;
    }
    await refreshMethods();
    setShowAddCard(false);
    setCardLast4("");
    setCardExpMonth("");
    setCardExpYear("");
  }

  async function makeDefault(id: string) {
    if (await setDefaultPaymentMethod(id)) await refreshMethods();
  }

  async function removeCard(id: string) {
    if (await removePaymentMethod(id)) await refreshMethods();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight lowercase">
          billing
        </h1>
        <p className="text-sm text-muted-foreground">
          your payment methods and charges.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">
            payment methods
          </h2>
          {!showAddCard && (
            <Button
              variant="ghost"
              size="xs"
              type="button"
              onClick={() => setShowAddCard(true)}
            >
              <Plus />
              add card
            </Button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : methods.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {methods.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  <span className="font-medium">
                    {m.brand} ••{m.last4}
                  </span>
                  {m.isDefault && (
                    <span className="text-xs text-muted-foreground">default</span>
                  )}
                </span>
                <span className="flex items-center gap-1">
                  {!m.isDefault && (
                    <Button
                      variant="ghost"
                      size="xs"
                      type="button"
                      onClick={() => void makeDefault(m.id)}
                    >
                      make default
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="xs"
                    type="button"
                    className="text-destructive"
                    onClick={() => void removeCard(m.id)}
                  >
                    <Trash2 />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Card className="border-dashed">
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              no cards on file yet. add one above.
            </CardContent>
          </Card>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {showAddCard && (
          <form
            onSubmit={addCard}
            className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3"
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="billing-brand" className="text-xs">
                  brand
                </Label>
                <Input
                  id="billing-brand"
                  value={cardBrand}
                  onChange={(e) => setCardBrand(e.target.value)}
                  placeholder="Visa"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="billing-last4" className="text-xs">
                  last 4
                </Label>
                <Input
                  id="billing-last4"
                  value={cardLast4}
                  onChange={(e) =>
                    setCardLast4(e.target.value.replace(/\D/g, "").slice(0, 4))
                  }
                  placeholder="4242"
                  inputMode="numeric"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="billing-exp-month" className="text-xs">
                  exp month
                </Label>
                <Input
                  id="billing-exp-month"
                  value={cardExpMonth}
                  onChange={(e) =>
                    setCardExpMonth(e.target.value.replace(/\D/g, "").slice(0, 2))
                  }
                  placeholder="12"
                  inputMode="numeric"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="billing-exp-year" className="text-xs">
                  exp year
                </Label>
                <Input
                  id="billing-exp-year"
                  value={cardExpYear}
                  onChange={(e) =>
                    setCardExpYear(e.target.value.replace(/\D/g, "").slice(0, 4))
                  }
                  placeholder="2028"
                  inputMode="numeric"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={addingCard}>
                {addingCard && <Loader2 className="animate-spin" />}
                save card
              </Button>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => setShowAddCard(false)}
              >
                cancel
              </Button>
            </div>
          </form>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">charges</h2>
        {orders.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              no charges yet.
            </CardContent>
          </Card>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {orders.map((o) => {
              const totalCents = o.totalCents ?? o.priceCents;
              return (
                <li key={o.id} className="flex flex-col gap-1 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-mono text-sm">
                      {o.domainName}
                    </span>
                    <span className="shrink-0 text-sm font-medium tabular-nums">
                      {money(totalCents)}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {o.status} · {new Date(o.createdAt).toLocaleString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                    {o.error ? ` · ${o.error}` : ""}
                  </span>
                  {o.addons && o.addons.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {o.addons.map((a, i) => (
                        <span
                          key={i}
                          className={cn(
                            "rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground",
                          )}
                        >
                          {a.type} · {a.plan} · {money(a.priceCents)}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}