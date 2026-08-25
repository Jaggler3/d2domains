import { describe, expect, test } from "bun:test";
import { mailboxLocalPart, randomPassword } from "../lib/mailbox";

describe("mailboxLocalPart", () => {
  test("first mailbox is admin, subsequent are user2..N", () => {
    expect(mailboxLocalPart(1)).toBe("admin");
    expect(mailboxLocalPart(2)).toBe("user2");
    expect(mailboxLocalPart(3)).toBe("user3");
  });
});

describe("randomPassword", () => {
  test("produces url-safe passwords of usable length", () => {
    for (let i = 0; i < 20; i++) {
      const pw = randomPassword();
      expect(pw.length).toBeGreaterThanOrEqual(15);
      expect(/^[a-zA-Z0-9]+$/.test(pw)).toBe(true);
    }
  });

  test("does not repeat itself", () => {
    const seen = new Set(Array.from({ length: 50 }, () => randomPassword()));
    expect(seen.size).toBe(50);
  });
});
