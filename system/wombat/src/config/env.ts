import { z } from "zod";

const EnvSchema = z.object({
  INTERNAL_TOKEN: z.string().min(1),
  WOMBAT_DATABASE_URL: z.string().min(1),
  WOMBAT_PORT: z.coerce.number().int().positive().default(8782),
  /** fake processor declines charges >= this amount (0 = never decline) */
  FAKE_PAYMENT_FAIL_MIN_CENTS: z.coerce.number().int().nonnegative().default(0),
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
