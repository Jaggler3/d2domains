"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { CardElement, Elements, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  addPaymentMethod,
  createSetupIntent,
  buyDomain,
  getPaymentMethods,
  quoteDomain,
  removePaymentMethod,
  setDefaultPaymentMethod,
  type AddonLine,
  type PaymentMethod,
  type Quote,
} from "@/lib/checkout";

const YEARS = [1, 2, 3, 5, 10];
const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "");
const useTestCardForm = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY === "pk_test_playwright_stub";

const money = (cents: number | null | undefined) =>
  cents == null ? "—" : `$${(cents / 100).toFixed(2)}`;

export function CheckoutForm({ domain }: { domain: string }) {
  const router = useRouter();
  const domainName = domain.trim().toLowerCase();

  const [authed, setAuthed] = useState<boolean | null>(null);
  const [years, setYears] = useState(1);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loadingQuote, setLoadingQuote] = useState(true);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [emailEnabled, setEmailEnabled] = useState(false);

  const [showAddCard, setShowAddCard] = useState(false);
  const [addingCard, setAddingCard] = useState(false);

  const [buying, setBuying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/v1/auth/me");
      if (!res.ok) {
        if (domainName) window.localStorage.setItem("pendingBuy", domainName);
        router.replace("/login");
        return;
      }
      setAuthed(true);
      const m = await getPaymentMethods();
      setMethods(m);
      setSelectedMethod(m.find((x) => x.isDefault)?.id ?? null);
    })();
  }, [domainName, router]);

  useEffect(() => {
    if (!authed || !domainName) return;
    let cancelled = false;
    quoteDomain(domainName, years).then((q) => {
      if (cancelled) return;
      setQuote(q);
      setLoadingQuote(false);
    });
    return () => {
      cancelled = true;
    };
  }, [authed, domainName, years]);

  const emailPlan = quote?.addonOptions.find((o) => o.type === "email") ?? null;
  const emailLine: AddonLine | null =
    emailEnabled && emailPlan && quote
      ? {
          type: "email",
          plan: emailPlan.plan,
          mailboxes: 1,
          years,
          priceCents: emailPlan.pricePerYearCents * years,
        }
      : null;
  const domainLineCents = quote?.priceCents ?? 0;
  const totalCents = domainLineCents + (emailLine?.priceCents ?? 0);

  const refreshMethods = useCallback(async () => {
    const m = await getPaymentMethods();
    setMethods(m);
    setSelectedMethod((prev) =>
      prev && m.some((x) => x.id === prev)
        ? prev
        : (m.find((x) => x.isDefault)?.id ?? null),
    );
  }, []);

  async function makeDefault(id: string) {
    if (await setDefaultPaymentMethod(id)) await refreshMethods();
  }

  async function removeCard(id: string) {
    if (await removePaymentMethod(id)) await refreshMethods();
  }

  async function confirm() {
    setBuying(true);
    setError(null);
    const result = await buyDomain({
      domainName,
      years,
      paymentMethodId: selectedMethod,
      addons: emailLine ? [emailLine] : [],
    });
    if (result.unauthorized) {
      window.localStorage.setItem("pendingBuy", domainName);
      router.push("/login");
      return;
    }
    if (!result.ok) {
      setError(result.error ?? "purchase failed");
      setBuying(false);
      return;
    }
    router.push("/account");
  }

  if (!domainName) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">
          no domain selected.{" "}
          <Link href="/" className="font-medium text-primary hover:underline">
            search for one
          </Link>
        </p>
      </Shell>
    );
  }

  if (authed === null) {
    return (
      <Shell>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="size-5 animate-spin text-primary" />
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="font-mono text-base lowercase">{domainName}</CardTitle>
          <CardDescription>
            {quote?.purchasable
              ? quote.premium
                ? "premium domain"
                : "domain registration"
              : "confirm your purchase details."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {error && <p className="text-sm text-destructive">{error}</p>}

          {loadingQuote ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="size-5 animate-spin text-primary" />
            </div>
          ) : quote && !quote.purchasable ? (
            <p className="text-sm text-destructive">
              that domain is no longer available.
            </p>
          ) : quote ? (
            <>
              <div className="flex flex-col gap-3">
                <Label>term</Label>
                <div className="flex flex-wrap gap-2">
                  {YEARS.map((y) => (
                    <Button
                      key={y}
                      variant={years === y ? "secondary" : "outline"}
                      size="sm"
                      onClick={() => {
                        setLoadingQuote(true);
                        setYears(y);
                      }}
                      className={cn(years === y && "ring-2 ring-primary/30")}
                    >
                      {y} {y === 1 ? "year" : "years"}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {money(quote.annualPriceCents)}/yr
                  {quote.renewalPriceCents != null &&
                    ` · renews at ${money(quote.renewalPriceCents)}/yr`}
                </p>
              </div>

              {emailPlan && (
                <div className="flex flex-col gap-2">
                  <Label>add-ons</Label>
                  <Button
                    variant={emailEnabled ? "secondary" : "outline"}
                    className={cn(
                      "justify-between",
                      emailEnabled && "ring-2 ring-primary/30",
                    )}
                    onClick={() => setEmailEnabled((v) => !v)}
                  >
                    <span className="flex items-center gap-2">
                      {emailPlan.label}
                      <span className="text-xs text-muted-foreground">
                        mailbox for {domainName}
                      </span>
                    </span>
                    <span className="text-xs">
                      {money(emailPlan.pricePerYearCents)}/yr
                    </span>
                  </Button>
                </div>
              )}

              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <Label>payment method</Label>
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

                {methods.length > 0 ? (
                  <ul className="flex flex-col gap-2">
                    {methods.map((m) => (
                      <li key={m.id}>
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedMethod(m.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelectedMethod(m.id);
                            }
                          }}
                          className={cn(
                            "flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2 text-left text-sm transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                            selectedMethod === m.id &&
                              "ring-2 ring-primary/40",
                          )}
                        >
                          <span className="flex items-center gap-2">
                            <span
                              className={cn(
                                "size-3 rounded-full border border-foreground/30",
                                selectedMethod === m.id &&
                                  "border-primary bg-primary",
                              )}
                            />
                            <span className="font-medium">
                              {m.brand} ••{m.last4}
                            </span>
                            {m.isDefault && (
                              <span className="text-xs text-muted-foreground">
                                default
                              </span>
                            )}
                          </span>
                          <span className="flex items-center gap-1">
                            {!m.isDefault && (
                              <Button
                                variant="ghost"
                                size="xs"
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void makeDefault(m.id);
                                }}
                              >
                                make default
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="xs"
                              type="button"
                              className="text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                void removeCard(m.id);
                              }}
                            >
                              <Trash2 />
                            </Button>
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    no card on file — add one below, or a default card is created
                    on your first purchase.
                  </p>
                )}

                {showAddCard && (
                  <StripeCardForm
                    onSaved={async (token) => {
                      setAddingCard(true);
                      setError(null);
                      const method = await addPaymentMethod({ token });
                      setAddingCard(false);
                      if (!method) {
                        setError("failed to add card");
                        return;
                      }
                      await refreshMethods();
                      setSelectedMethod(method.id);
                      setShowAddCard(false);
                    }}
                    onCancel={() => setShowAddCard(false)}
                    loading={addingCard}
                  />
                )}
              </div>

              <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/30 px-3 py-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    {domainName} · {years} {years === 1 ? "year" : "years"}
                  </span>
                  <span className="tabular-nums">{money(domainLineCents)}</span>
                </div>
                {emailLine && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {emailPlan?.label} · {emailLine.mailboxes} mailbox
                      {emailLine.mailboxes !== 1 ? "s" : ""}
                    </span>
                    <span className="tabular-nums">{money(emailLine.priceCents)}</span>
                  </div>
                )}
                <div className="mt-1 flex justify-between border-t border-border pt-2 text-sm font-medium">
                  <span>total</span>
                  <span className="tabular-nums">{money(totalCents)}</span>
                </div>
              </div>

              <Button size="lg" className="w-full" onClick={confirm} disabled={buying}>
                {buying && <Loader2 className="animate-spin" />}
                confirm & pay {money(totalCents)}
              </Button>
            </>
          ) : (
            <p className="text-sm text-destructive">
              could not load a quote for that domain.
            </p>
          )}
        </CardContent>
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-svh flex-1 items-center justify-center overflow-hidden px-4 py-12">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(249,115,22,0.1),transparent_60%)]" />
      <div className="relative flex w-full max-w-lg flex-col gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <Brand className="text-xl" />
          <p className="text-sm text-muted-foreground">checkout.</p>
        </div>
        {children}
      </div>
    </div>
  );
}

function StripeCardForm({
  onSaved,
  onCancel,
  loading,
}: {
  onSaved: (paymentMethodId: string) => Promise<void>;
  onCancel: () => void;
  loading: boolean;
}) {
  if (useTestCardForm) {
    return (
      <TestCardForm onSaved={onSaved} onCancel={onCancel} loading={loading} />
    );
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{
        mode: "setup",
        currency: "usd",
        paymentMethodCreation: "manual",
      }}
    >
      <StripeCardFormInner onSaved={onSaved} onCancel={onCancel} loading={loading} />
    </Elements>
  );
}

function TestCardForm({
  onSaved,
  onCancel,
  loading,
}: {
  onSaved: (paymentMethodId: string) => Promise<void>;
  onCancel: () => void;
  loading: boolean;
}) {
  const [cardNumber, setCardNumber] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await onSaved("pm_test_4242");
    setSaving(false);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3">
      <label className="rounded-md border border-border bg-card px-3 py-2">
        <span className="mb-2 block text-xs text-muted-foreground">card number</span>
        <input
          aria-label="Card number"
          value={cardNumber}
          onChange={(e) => setCardNumber(e.target.value)}
          className="w-full bg-transparent text-sm outline-none"
          placeholder="4242 4242 4242 4242"
        />
      </label>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={saving || loading}>
          {(saving || loading) && <Loader2 className="animate-spin" />}
          save card
        </Button>
        <Button variant="ghost" size="sm" type="button" onClick={onCancel}>
          cancel
        </Button>
      </div>
    </form>
  );
}

function StripeCardFormInner({
  onSaved,
  onCancel,
  loading,
}: {
  onSaved: (paymentMethodId: string) => Promise<void>;
  onCancel: () => void;
  loading: boolean;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSaving(true);
    const clientSecret = await createSetupIntent();
    if (!clientSecret) {
      setSaving(false);
      return;
    }
    const card = elements.getElement(CardElement);
    if (!card) {
      setSaving(false);
      return;
    }
    const result = await stripe.confirmCardSetup(clientSecret, {
      payment_method: { card },
    });
    if (result.error || !result.setupIntent?.payment_method) {
      setSaving(false);
      return;
    }
    await onSaved(result.setupIntent.payment_method as string);
    setSaving(false);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3">
      <div className="rounded-md border border-border bg-card px-3 py-2">
        <CardElement
          options={{
            hidePostalCode: true,
            style: {
              base: {
                color: "var(--foreground)",
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: "14px",
                "::placeholder": { color: "var(--muted-foreground)" },
              },
            },
          }}
        />
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={saving || loading || !stripe || !elements}>
          {(saving || loading) && <Loader2 className="animate-spin" />}
          save card
        </Button>
        <Button variant="ghost" size="sm" type="button" onClick={onCancel}>
          cancel
        </Button>
      </div>
    </form>
  );
}
