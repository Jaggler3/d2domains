import { describe, expect, test } from "bun:test";
import { loadEnv } from "./env";

const BASE = {
  NAME_COM_USERNAME: "user",
  NAME_COM_TOKEN: "token",
  DATABASE_URL: "postgresql://localhost:5432/d2gres",
};

describe("loadEnv", () => {
  test("parses a complete env", () => {
    const env = loadEnv(BASE);
    expect(env.NAME_COM_USERNAME).toBe("user");
    expect(env.NAME_COM_BASE).toBe("https://api.dev.name.com");
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

  test("rejects a non-url base", () => {
    expect(() => loadEnv({ ...BASE, NAME_COM_BASE: "not a url" })).toThrow(
      /invalid environment/,
    );
  });
});
