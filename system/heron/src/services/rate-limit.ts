import type { Redis } from "ioredis";

const CONSUME_LUA = `
local key = KEYS[1]
local burst = tonumber(ARGV[1])
local refillPerSec = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local bucket = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(bucket[1])
local ts = tonumber(bucket[2])
if tokens == nil or ts == nil then
  tokens = burst
  ts = now
end
local elapsed = math.max(0, now - ts)
local add = elapsed * (refillPerSec / 1000)
tokens = math.min(burst, tokens + add)
if tokens >= 1 then
  redis.call('HSET', key, 'tokens', tokens - 1, 'ts', now)
  return 1
else
  redis.call('HSET', key, 'tokens', tokens, 'ts', now)
  redis.call('PEXPIRE', key, math.ceil(60000 / refillPerSec) + 1000)
  return 0
end
`;

export interface TokenBucketOptions {
  burst: number;
  refillPerSec: number;
  key: string;
}

export function createRateLimiter(redis: Redis) {
  return {
    /** Atomically consume one token. Returns true if allowed. */
    async consume(opts: TokenBucketOptions): Promise<boolean> {
      try {
        const result = (await redis.eval(
          CONSUME_LUA,
          1,
          opts.key,
          String(opts.burst),
          String(opts.refillPerSec),
          String(Date.now()),
        )) as number;
        return result === 1;
      } catch (err) {
        console.error("[heron] rate limiter error (failing open):", err);
        return true;
      }
    },
  };
}
