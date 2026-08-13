export interface RetryOptions {
  maxAttempts: number;
  /** base delay in ms; the nth retry sleeps base * 2^(n-1) plus jitter */
  baseDelayMs: number;
  /** circuit breaker: fail-fast once too many failures land in a window */
  breaker?: {
    windowMs: number;
    failureThreshold: number;
    openMs: number;
  };
  isRetryable: (err: unknown) => boolean;
  retryAfterMs?: (err: unknown) => number | null;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export function backoffDelayMs(attempt: number, baseDelayMs: number, jitter = 0.25): number {
  const exponential = baseDelayMs * 2 ** (attempt - 1);
  const jitterAmt = exponential * jitter * (Math.random() * 2 - 1);
  return Math.max(1, Math.round(exponential + jitterAmt));
}

export class CircuitBreaker {
  private failures: number[] = [];
  private openedAt: number | null = null;

  constructor(
    private readonly opts: { windowMs: number; failureThreshold: number; openMs: number },
    private readonly now: () => number = Date.now,
  ) {}

  get allowed(): boolean {
    if (this.openedAt !== null) {
      if (this.now() - this.openedAt >= this.opts.openMs) {
        this.openedAt = null;
        this.failures = [];
        return true;
      }
      return false;
    }
    return true;
  }

  recordFailure(): void {
    const t = this.now();
    this.failures = this.failures.filter((f) => t - f < this.opts.windowMs);
    this.failures.push(t);
    if (this.failures.length >= this.opts.failureThreshold) {
      this.openedAt = t;
    }
  }

  recordSuccess(): void {
    this.failures = [];
  }
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const breaker = opts.breaker ? new CircuitBreaker(opts.breaker, opts.now) : null;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let lastError: unknown;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    if (breaker && !breaker.allowed) {
      throw new Error("upstream circuit breaker is open");
    }
    try {
      const result = await fn();
      breaker?.recordSuccess();
      return result;
    } catch (err) {
      breaker?.recordFailure();
      lastError = err;
      const retryable = opts.isRetryable(err);
      if (!retryable || attempt === opts.maxAttempts) {
        throw err;
      }
      const retryAfter = opts.retryAfterMs?.(err) ?? null;
      const delay = retryAfter ?? backoffDelayMs(attempt, opts.baseDelayMs);
      await sleep(delay);
    }
  }
  throw lastError;
}
