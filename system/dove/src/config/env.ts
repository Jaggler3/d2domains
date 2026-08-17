import { z } from "zod";

const EnvSchema = z.object({
  INTERNAL_TOKEN: z.string().min(1),
  DOVE_DATABASE_URL: z.string().min(1),
  WEASEL_URL: z.string().url().default("http://localhost:8781"),
  OTTER_URL: z.string().url().default("http://localhost:8784"),
  STALWART_URL: z.string().url().default("http://localhost:18080"),
  DOVE_PORT: z.coerce.number().int().positive().default(8786),
  STALWART_ADMIN_USER: z.string().min(1).default("admin"),
  STALWART_ADMIN_PASSWORD: z.string().min(1).default("dev-admin-password"),
  STALWART_API_KEY: z.string().optional(),
  MAIL_HOST: z.string().min(1).default("mail.d2domains.dev"),
  DOVE_PGHOST: z.string().min(1).default("localhost"),
  DOVE_PGPORT: z.coerce.number().int().positive().default(5432),
  DOVE_PGUSER: z.string().min(1).default("postgres"),
  DOVE_PGPASSWORD: z.string().min(1).default("postgres"),
  DOVE_PGDATABASE: z.string().min(1).default("d2dove"),
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