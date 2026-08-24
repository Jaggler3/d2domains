import { expect, test } from "@playwright/test";

const authUser = {
  user: {
    id: "user_123",
    email: "test@example.com",
    createdAt: "2026-08-24T00:00:00.000Z",
  },
};

const quote = {
  quote: {
    domainName: "test-email.com",
    purchasable: true,
    premium: false,
    purchaseType: "standard",
    years: 1,
    annualPriceCents: 1299,
    renewalPriceCents: 1499,
    priceCents: 1299,
    totalCents: 1299,
    addonOptions: [
      {
        type: "email",
        plan: "starter",
        label: "Email Starter",
        pricePerYearCents: 599,
      },
    ],
  },
};

test.describe("checkout card entry", () => {
  test("adds a card, then submits checkout with the saved payment method", async ({ page }) => {
    let paymentMethodId = "";
    let setupIntentCalls = 0;
    let buyPayload: Record<string, unknown> | null = null;

    await page.route("**/api/v1/auth/me", async (route) => {
      await route.fulfill({ json: authUser });
    });

    await page.route("**/api/v1/domains/quote", async (route) => {
      await route.fulfill({ json: quote });
    });

    await page.route("**/api/v1/billing/methods/setup-intent", async (route) => {
      setupIntentCalls += 1;
      await route.fulfill({ json: { clientSecret: "seti_test_secret" } });
    });

    let savedMethods: any[] = [];
    await page.route("**/api/v1/billing/methods", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: { paymentMethods: savedMethods } });
        return;
      }
      const body = route.request().postDataJSON() as { token?: string };
      paymentMethodId = body.token ? "pm_saved_1" : "pm_saved_0";
      const newMethod = {
        id: paymentMethodId,
        userId: authUser.user.id,
        provider: "fake",
        brand: "Visa",
        last4: "4242",
        isDefault: true,
      };
      savedMethods.push(newMethod);
      await route.fulfill({
        status: 201,
        json: {
          paymentMethod: newMethod,
        },
      });
    });

    await page.route("**/api/v1/domains/buy", async (route) => {
      buyPayload = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ json: { ok: true } });
    });

    await page.goto("/checkout?domain=test-email.com");

    await expect(page.getByText("checkout.")).toBeVisible();
    await expect(page.getByText("test-email.com", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "add card" }).click();

    let isMock = false;
    const mockCardInput = page.getByLabel("Card number");
    try {
      await expect(mockCardInput).toBeVisible({ timeout: 2000 });
      await mockCardInput.fill("4242424242424242");
      isMock = true;
    } catch {
      const stripeFrame = page.frames().find((frame) => frame.url().includes("stripe"));
      expect(stripeFrame, "stripe frame").toBeTruthy();
      await stripeFrame!.locator("input").fill("4242424242424242");
    }

    await page.getByRole("button", { name: "save card" }).click();
    await expect(page.getByText("Visa ••4242")).toBeVisible();

    await page.getByRole("button", { name: "confirm & pay $12.99" }).click();

    if (!isMock) {
      await expect.poll(() => setupIntentCalls).toBe(1);
    }
    await expect(buyPayload).toMatchObject({
      domainName: "test-email.com",
      years: 1,
      paymentMethodId: paymentMethodId,
      addons: [],
    });
  });
});
