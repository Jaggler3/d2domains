import { expect, test } from "@playwright/test";

/**
 * REAL purchase journey against production:
 *   register → pick cheapest available domain → checkout with email add-on
 *   → save a TEST CARD through real Stripe Elements → buy → mailbox appears.
 *
 * Costs: one real domain registration charged to the Spaceship account
 * balance; the card charge itself is Stripe TEST money.
 *
 * Run: cd client && PROD_URL=https://18-227-229-244.sslip.io \
 *        npx playwright test --config playwright.prod.config.ts
 */

const BASE = process.env.PROD_URL ?? "https://18-227-229-244.sslip.io";
const tag = Date.now().toString(36);
const email = `prod-buy-${tag}@e2e.test.local`;
const password = `pw-${tag}-A1`;

const CANDIDATES: [string, string[]][] = [
  ["cheap", ["xyz", "online", "site", "info", "com", "shop", "space", "website", "store", "fun"]],
  ["d2d", ["xyz", "online", "site", "info", "shop", "space", "website", "store", "fun", "com"]],
];

async function findCheapest(): Promise<{ domainName: string; price: number }> {
  let best: { domainName: string; price: number } | null = null;
  for (const [keyword, tlds] of CANDIDATES) {
    const res = await fetch(`${BASE}/api/v1/domains/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: `${keyword}${tag}`, tldFilter: tlds }),
    });
    const data = (await res.json()) as {
      results?: { purchasable: boolean; premium: boolean; purchasePrice?: number; renewalPrice?: number; domainName: string }[];
    };
    for (const r of data.results ?? []) {
      if (!r.purchasable || r.premium || r.purchasePrice == null) continue;
      // judge by renewal price too — avoid $1 first-year traps with $40 renewals
      const score = r.purchasePrice + (r.renewalPrice ?? r.purchasePrice);
      if (!best || score < best.price) best = { domainName: r.domainName, price: score };
    }
  }
  if (!best) throw new Error("no purchasable domain found");
  return { domainName: best.domainName, price: best.price };
}

test("register, buy cheapest domain with email on production", async ({ page }) => {
  test.setTimeout(600_000);
  const { domainName } = await findCheapest();
  console.log(`>>> buying ${domainName} on ${BASE}`);

  // 1. register through the UI
  await page.goto(`${BASE}/register`);
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /create account|sign up|register/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/register"), { timeout: 60_000 });

  // 2. straight to checkout
  await page.goto(`${BASE}/checkout?domain=${domainName}`);
  const payButton = page.getByRole("button", { name: /confirm & pay/i });
  await expect(payButton).toBeVisible({ timeout: 30_000 });

  // 3. email add-on
  await page.getByRole("button", { name: /email starter/i }).click();

  // 4. save a TEST CARD through real Stripe Elements
  await page.getByRole("button", { name: "add card" }).click();

  async function fillStripeField(
    placeholder: RegExp,
    value: string,
    timeout = 40_000,
  ) {
    await expect
      .poll(async () => {
        for (const f of page.frames()) {
          if (!f.url().includes("stripe.com")) continue;
          const field = f.getByPlaceholder(placeholder);
          if ((await field.count()) > 0) {
            try {
              await field.first().fill(value, { timeout: 5_000 });
              return true;
            } catch {
              /* not interactable yet */
            }
          }
        }
        return false;
      }, { timeout })
      .toBe(true);
  }

  await fillStripeField(/card number/i, "4242424242424242");
  await fillStripeField(/MM\s*\/\s*YY/i, "12 / 34");
  await fillStripeField(/^CVC$/i, "314");
  await page.getByRole("button", { name: "save card" }).click();
  await expect(page.getByText(/••\d{4}/).first()).toBeVisible({ timeout: 30_000 });

  // 5. pay (real Stripe TEST charge + real Spaceship registration)
  await payButton.click();
  await page.waitForURL("**/account", { timeout: 180_000 });
  console.log(`>>> purchased ${domainName}`);

  // 6. mailbox provisioning (real Stalwart + real DNS sync)
  await page.goto(`${BASE}/account/${domainName}`);
  const mailboxAddress = page.getByText(`admin@${domainName}`, { exact: true });
  let visible = false;
  for (let i = 0; i < 80 && !visible; i++) {
    try {
      await expect(mailboxAddress).toBeVisible({ timeout: 5_000 });
      visible = true;
    } catch {
      await page.reload();
    }
  }
  expect(visible, "mailbox credentials should appear on the domain page").toBe(true);
  console.log(`>>> mailbox live: admin@${domainName}`);
});
