export interface AddonLine {
  type: string;
  plan: string;
  mailboxes: number;
  years: number;
  priceCents: number;
}

export interface EmailPlan {
  type: "email";
  plan: string;
  label: string;
  pricePerYearCents: number;
}

export const EMAIL_PLANS: Record<string, EmailPlan> = {
  starter: {
    type: "email",
    plan: "starter",
    label: "Email Starter",
    pricePerYearCents: 2999,
  },
};

export function emailAddonPriceCents(
  plan: string,
  mailboxes: number,
  years: number,
): number {
  const catalog = EMAIL_PLANS[plan];
  if (!catalog) throw new Error(`unknown email plan: ${plan}`);
  return catalog.pricePerYearCents * mailboxes * years;
}

export function addonTotalCents(addons: AddonLine[]): number {
  return addons.reduce((sum, a) => sum + a.priceCents, 0);
}

export interface AddonInput {
  type?: string;
  plan?: string;
  mailboxes?: number;
  years?: number;
}

export function buildAddons(input: AddonInput[], orderYears: number): AddonLine[] {
  const out: AddonLine[] = [];
  for (const a of input ?? []) {
    if (a.type !== "email") continue;
    const catalog = EMAIL_PLANS[a.plan ?? ""];
    if (!catalog) throw new Error(`unknown email plan: ${a.plan}`);
    const years = Math.min(Math.max(a.years ?? orderYears, 1), 10);
    const mailboxes = Math.min(Math.max(a.mailboxes ?? 1, 1), 100);
    out.push({
      type: "email",
      plan: catalog.plan,
      mailboxes,
      years,
      priceCents: emailAddonPriceCents(catalog.plan, mailboxes, years),
    });
  }
  return out;
}