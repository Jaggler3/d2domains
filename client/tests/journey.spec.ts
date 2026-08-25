import { expect, test } from "@playwright/test";

/**
 * Full browser journey against the live mock compose stack:
 * register → search → checkout (with email add-on) → buy → dashboard →
 * domain detail shows provisioned mailbox.
 *
 * Requires `docker compose -f docker-compose.yml -f docker-compose.mock.yml up`
 * (see e2e/up.sh). The Next dev server is started by playwright.config.ts.
 */

const HOG = process.env.HOG_URL ?? "http://127.0.0.1:8787";

const tag = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const email = `browser-${tag}@e2e.test.local`;
const password = `pw-${tag}-A1`;

async function findAvailableDomain(): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const keyword = `br${tag}${String.fromCharCode(97 + i)}`;
    const res = await fetch(`${HOG}/api/v1/domains/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword, tldFilter: ["com"] }),
    });
    const data = (await res.json()) as { results?: { purchasable: boolean; premium: boolean; domainName: string }[] };
    const hit = (data.results ?? []).find((r) => r.purchasable && !r.premium);
    if (hit) return hit.domainName;
  }
  throw new Error("no available domain found");
}

test("register, search, buy with email, see mailbox on domain page", async ({ page }) => {
  test.setTimeout(420_000);
  const domainName = await findAvailableDomain();
  const sld = domainName.split(".")[0];

  // 1. register through the UI
  await page.goto("/register");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /create account|sign up|register/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/register"), { timeout: 30_000 });

  // 2. search on the landing page and pick the available result
  await page.goto("/");
  const input = page.getByLabel("domain search");
  await input.click();
  await input.type(sld, { delay: 40 });
  const resultItem = page.getByRole("listitem").filter({ hasText: domainName });
  await expect(resultItem).toBeVisible({ timeout: 20_000 });
  await resultItem.getByRole("button", { name: "get it" }).click();
  await page.waitForURL(`**/checkout?domain=${domainName}`);

  // 3. enable the email add-on
  const quoteLoaded = page.getByRole("button", { name: /confirm & pay/i });
  await expect(quoteLoaded).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /email starter/i }).click();

  // 4. save a card (mock entry path — no real Stripe key in e2e).
  // wombat's fake processor stores defaults, shown as "••0000".
  await page.getByRole("button", { name: "add card" }).click();
  await page.getByLabel("Card number").fill("4242424242424242");
  await page.getByRole("button", { name: "save card" }).click();
  await expect(page.getByText(/••\d{4}/).first()).toBeVisible({ timeout: 20_000 });

  // 5. buy
  await quoteLoaded.click();
  await page.waitForURL("**/account", { timeout: 60_000 });

  // 6. domain appears on the dashboard
  const domainLink = page.getByRole("link", { name: new RegExp(domainName.replace(".", "\\.")) });
  await expect(domainLink).toBeVisible({ timeout: 60_000 });

  // 7. domain detail page eventually shows the provisioned mailbox
  await domainLink.click();
  await page.waitForURL(`**/account/${domainName}`);
  const mailboxAddress = page.getByText(`admin@${domainName}`, { exact: true });
  let visible = false;
  for (let i = 0; i < 60 && !visible; i++) {
    try {
      await expect(mailboxAddress).toBeVisible({ timeout: 5_000 });
      visible = true;
    } catch {
      await page.reload();
    }
  }
  expect(visible).toBe(true);
});
