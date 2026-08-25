import { z } from "zod";

const EnvSchema = z.object({
  INTERNAL_TOKEN: z.string().min(1),
  SPACESHIP_USERNAME: z.string().min(1),
  SPACESHIP_TOKEN: z.string().min(1),
  SPACESHIP_BASE: z.string().url().default("https://spaceship.dev/api"),
  SPACESHIP_REGISTRANT_CONTACT_ID: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().min(1).optional(),
  ),
  TLD_PRICES: z.string().optional(),
  DEFAULT_TLD_PRICE: z.coerce.number().positive().default(12.99),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  HERON_PORT: z.coerce.number().int().positive().default(8783),
  REGISTRY_RATE_BURST: z.coerce.number().int().positive().default(20),
  REGISTRY_RATE_REFILL: z.coerce.number().positive().default(5),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(
  source: Record<string, string | undefined> = typeof Bun !== "undefined"
    ? Bun.env
    : process.env,
): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`invalid environment: ${parsed.error.message}`);
  }
  return parsed.data;
}
