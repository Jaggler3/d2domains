import { describe, expect, test } from "bun:test";
import {
  basePrice,
  checkCandidates,
  djb2,
  hashState,
  searchCandidates,
} from "./lib";

describe("djb2", () => {
  test("is deterministic", () => {
    expect(djb2("hog.com")).toBe(djb2("hog.com"));
  });

  test("differs across inputs", () => {
    expect(djb2("hog.com")).not.toBe(djb2("hog.net"));
  });
});

describe("hashState", () => {
  test("is stable and returns valid states", () => {
    for (const tld of ["com", "net", "org", "io", "dev"]) {
      const state = hashState("foobar", tld);
      expect(["available", "premium", "taken"]).toContain(state);
      expect(hashState("foobar", tld)).toBe(state);
    }
  });
});

describe("basePrice", () => {
  test("known tlds have prices", () => {
    expect(basePrice("com")).toBe(12.99);
    expect(basePrice("io")).toBeGreaterThan(basePrice("org"));
  });

  test("unknown tlds fall back", () => {
    expect(basePrice("xyz")).toBe(10.99);
  });
});

describe("searchCandidates", () => {
  test("marks known-taken domains unavailable even when hash says available", () => {
    const results = searchCandidates("example", ["com"], () => true);
    expect(results[0]).toMatchObject({
      domainName: "example.com",
      purchasable: false,
      purchaseType: "unavailable",
    });
  });

  test("generates results per requested tld only", () => {
    const results = searchCandidates("abc", ["com", "net"], () => false);
    expect(results.map((r) => r.tld)).toEqual(["com", "net"]);
  });

  test("every result carries sld + tld", () => {
    const results = searchCandidates("abc", ["com", "net", "org"], () => false);
    for (const r of results) {
      expect(r.sld).toBe("abc");
      expect(r.domainName).toBe(`${r.sld}.${r.tld}`);
    }
  });
});

describe("checkCandidates", () => {
  test("handles exact names", () => {
    const results = checkCandidates(["foo.com", "bar.net"], () => false);
    expect(results.map((r) => r.domainName)).toEqual(["foo.com", "bar.net"]);
  });

  test("rejects malformed names", () => {
    const results = checkCandidates(["notadomain"], () => false);
    expect(results[0]).toMatchObject({ purchasable: false, purchaseType: "invalid" });
  });
});
