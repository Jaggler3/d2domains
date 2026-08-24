import { z } from "zod";

const EnvSchema = z.object({
  INTERNAL_TOKEN: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  REGISTRY_URL: z.string().url().default("http://localhost:8783"),
  WEASEL_URL: z.string().url().default("http://localhost:8781"),
  WOMBAT_URL: z.string().url().default("http://localhost:8782"),
  OTTER_URL: z.string().url().default("http://localhost:8784"),
  DOVE_URL: z.string().url().default("http://localhost:8786"),
  PORT: z.coerce.number().int().positive().default(8787),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  APP_ENV: z.enum(["development", "production", "test"]).default("development"),
  CLIENT_ORIGIN: z.string().default("http://localhost:3000"),
  SEARCH_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  SEARCH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(30),
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
