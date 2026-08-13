import { describe, expect, test } from "bun:test";
import { normalizeRegistryResults } from "./registry-results";

describe("normalizeRegistryResults", () => {
  test("fills defaults for unavailable results (real API omits fields)", () => {
    const results = normalizeRegistryResults([
      { domainName: "otter.com", sld: "otter", tld: "com" },
    ]);
    expect(results[0]).toEqual({
      domainName: "otter.com",
      sld: "otter",
      tld: "com",
      purchasable: false,
      premium: false,
      purchasePrice: null,
      purchaseType: "unavailable",
      renewalPrice: null,
    });
  });

  test("passes through available + premium fields", () => {
    const results = normalizeRegistryResults([
      {
        domainName: "hog.live",
        sld: "hog",
        tld: "live",
        purchasable: true,
        premium: true,
        purchasePrice: 250,
        purchaseType: "registration",
        renewalPrice: 250,
      },
    ]);
    expect(results[0]).toMatchObject({
      purchasable: true,
      premium: true,
      purchasePrice: 250,
      purchaseType: "registration",
      renewalPrice: 250,
    });
  });

  test("derives sld/tld from domainName when missing", () => {
    const results = normalizeRegistryResults([{ domainName: "foo.bar" }]);
    expect(results[0]).toMatchObject({ sld: "foo", tld: "bar" });
  });
});
