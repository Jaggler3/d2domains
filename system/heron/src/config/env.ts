import { z } from "zod";

const EnvSchema = z.object({
  NAME_COM_USERNAME: z.string().min(1),
  NAME_COM_TOKEN: z.string().min(1),
  NAME_COM_BASE: z.string().url().default("https://api.dev.name.com"),
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
