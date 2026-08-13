import type { MiddlewareHandler } from "hono";
import type { Redis } from "ioredis";

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyFor: (c: Parameters<MiddlewareHandler>[0]) => string;
}

export function rateLimit(
  redis: Redis,
  opts: RateLimitOptions,
): MiddlewareHandler {
  return async (c, next) => {
    const key = `rl:${opts.keyFor(c)}`;
    const now = Date.now();
    const windowStart = now - opts.windowMs;

    const multi = redis.multi();
    multi.zremrangebyscore(key, 0, windowStart);
    multi.zadd(key, now, `${now}:${crypto.randomUUID()}`);
    multi.zcard(key);
    multi.expire(key, Math.ceil(opts.windowMs / 1000));
    const results = await multi.exec();

    const count = results?.[2]?.[1];
    if (typeof count === "number" && count > opts.max) {
      return c.json({ error: "rate limit exceeded" }, 429);
    }
    await next();
  };
}
