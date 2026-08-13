import { describe, expect, test } from "bun:test";
import { backoffDelayMs, CircuitBreaker, withRetry } from "./retry";

describe("backoffDelayMs", () => {
  test("grows exponentially per attempt", () => {
    const d1 = backoffDelayMs(1, 200, 0);
    const d2 = backoffDelayMs(2, 200, 0);
    const d3 = backoffDelayMs(3, 200, 0);
    expect(d1).toBe(200);
    expect(d2).toBe(400);
    expect(d3).toBe(800);
  });

  test("never returns zero or negative", () => {
    for (let i = 1; i <= 5; i++) {
      expect(backoffDelayMs(i, 200)).toBeGreaterThan(0);
    }
  });
});

describe("withRetry", () => {
  test("succeeds on first attempt", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        return "ok";
      },
      { maxAttempts: 3, baseDelayMs: 1, isRetryable: () => true, sleep: async () => {} },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  test("retries until success, honoring attempt count", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error("flaky");
        return "ok";
      },
      { maxAttempts: 3, baseDelayMs: 1, isRetryable: () => true, sleep: async () => {} },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  test("gives up and rethrows after maxAttempts", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error("boom");
        },
        { maxAttempts: 3, baseDelayMs: 1, isRetryable: () => true, sleep: async () => {} },
      ),
    ).rejects.toThrow("boom");
    expect(calls).toBe(3);
  });

  test("does not retry non-retryable errors", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error("fatal");
        },
        { maxAttempts: 3, baseDelayMs: 1, isRetryable: () => false, sleep: async () => {} },
      ),
    ).rejects.toThrow("fatal");
    expect(calls).toBe(1);
  });

  test("prefers retry-after over backoff", async () => {
    let calls = 0;
    let lastDelay = 0;
    await withRetry(
      async () => {
        calls++;
        throw new Error("429");
      },
      {
        maxAttempts: 3,
        baseDelayMs: 1000,
        isRetryable: () => true,
        retryAfterMs: () => 7,
        sleep: async (ms) => {
          lastDelay = ms;
        },
      },
    ).catch(() => {});
    expect(lastDelay).toBe(7);
  });
});

describe("CircuitBreaker", () => {
  test("opens after threshold failures and fails fast until open window elapses", () => {
    const breaker = new CircuitBreaker(
      { windowMs: 60_000, failureThreshold: 3, openMs: 30_000 },
      () => 1_000,
    );
    expect(breaker.allowed).toBe(true);
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.allowed).toBe(false);
  });

  test("success resets failure count", () => {
    const breaker = new CircuitBreaker(
      { windowMs: 60_000, failureThreshold: 3, openMs: 30_000 },
      () => 1_000,
    );
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();
    breaker.recordFailure();
    expect(breaker.allowed).toBe(true);
  });
});
