import { describe, expect, test } from "bun:test";
import {
  extractDkim,
  mailboxLocalPart,
  randomPassword,
} from "../lib/mailbox";

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

describe("extractDkim", () => {
  test("extracts selector and publicKey", () => {
    expect(
      extractDkim({ selector: "mail", publicKey: "ABCDEF" }),
    ).toEqual({ selector: "mail", publicKey: "ABCDEF" });
  });

  test("falls back to default selector and snake_case key names", () => {
    expect(extractDkim({ public_key: "KEY1" })).toEqual({
      selector: "default",
      publicKey: "KEY1",
    });
  });

  test("returns null when no public key is present yet", () => {
    expect(extractDkim({})).toBeNull();
    expect(extractDkim({ selector: "x" })).toBeNull();
    expect(extractDkim({ publicKey: "" })).toBeNull();
  });
});
