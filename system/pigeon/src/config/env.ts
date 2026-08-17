import { z } from "zod";

const EnvSchema = z.object({
  INTERNAL_TOKEN: z.string().min(1),
  PIGEON_DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  WEASEL_URL: z.string().url().default("http://localhost:8781"),
  OTTER_URL: z.string().url().default("http://localhost:8784"),
  PIGEON_PORT: z.coerce.number().int().positive().default(8785),

  MAIL_HOST: z.string().min(1).default("mail.example-mail.com"),
  MAIL_MX_PRIORITY: z.coerce.number().int().min(0).max(65535).default(10),
  MAIL_SPF_TXT: z.string().min(1).default("v=spf1 include:example-mail.com ~all"),
  MAIL_DKIM_TXT: z
    .string()
    .min(1)
    .default("v=DKIM1; k=rsa; p=REPLACE_WITH_PUBLIC_KEY"),
  MAIL_DMARC_TXT: z
    .string()
    .min(1)
    .default("v=DMARC1; p=none; rua=mailto:dmarc@example-mail.com"),
  DNS_TTL: z.coerce.number().int().positive().max(86400).default(3600),
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