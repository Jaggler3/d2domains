import { describe, expect, test } from "bun:test";
import { loadEnv } from "./env";

const BASE = {
  DATABASE_URL: "postgresql://localhost:5432/d2gres",
  INTERNAL_TOKEN: "test-token",
};

describe("loadEnv", () => {
  test("parses a complete env", () => {
    const env = loadEnv(BASE);
    expect(env.REGISTRY_URL).toBe("http://localhost:8783");
    expect(env.WEASEL_URL).toBe("http://localhost:8781");
    expect(env.PORT).toBe(8787);
    expect(env.COOKIE_SECURE).toBe(false);
  });

  test("rejects missing required vars", () => {
    expect(() => loadEnv({})).toThrow(/invalid environment/);
  });

  test("coerces numbers and booleans", () => {
    const env = loadEnv({ ...BASE, PORT: "9000", COOKIE_SECURE: "true" });
    expect(env.PORT).toBe(9000);
    expect(env.COOKIE_SECURE).toBe(true);
  });

  test("rejects a non-url registry url", () => {
    expect(() => loadEnv({ ...BASE, REGISTRY_URL: "not a url" })).toThrow(
      /invalid environment/,
    );
  });
});
