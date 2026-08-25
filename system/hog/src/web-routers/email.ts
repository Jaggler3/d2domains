import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { loadEnv } from "../config/env";
import { HttpError } from "../lib/http";
import { requireAuth, type AuthVariables } from "../middleware/auth";
import { assertDomainOwnership } from "../services/ownership";
import { addEmail, removeEmail } from "../services/email.service";

const env = loadEnv();

type Ctx = Context<{ Variables: AuthVariables }>;

const addEmailSchema = z.object({
  plan: z.string().max(40).optional(),
  mailboxes: z.number().int().min(1).max(100).optional(),
  paymentMethodId: z.string().min(1).nullable().optional(),
});

export const emailRouter = new Hono<{ Variables: AuthVariables }>()
  .get(
    "/:name/email",
    requireAuth,
    async (c: Ctx) => {
      const name = c.req.param("name");
      if (!name) throw new HttpError("domainName is required", 422);
      const userId = c.var.user.id;

      await assertDomainOwnership(userId, name);

      const res = await fetch(
        `${env.DOVE_URL}/internal/mailbox?domainName=${encodeURIComponent(name)}&userId=${encodeURIComponent(userId)}`,
        {
          headers: {
            "x-internal-token": env.INTERNAL_TOKEN,
          },
        },
      );

      const data = (await res.json().catch(() => null)) as
        | Record<string, unknown>
        | { error?: string }
        | null;

      if (!res.ok) {
        throw new HttpError(
          (data as { error?: string } | null)?.error ?? "mailbox unavailable",
          res.status,
        );
      }

      return c.json(data);
    },
  )
  .post(
    "/:name/email",
    requireAuth,
    async (c: Ctx) => {
      const name = c.req.param("name");
      if (!name) throw new HttpError("domainName is required", 422);
      const body = await c.req.json().catch(() => null);
      const parsed = addEmailSchema.safeParse(body ?? {});
      if (!parsed.success) throw new HttpError("invalid email plan", 422);

      const result = await addEmail(c.var.user.id, name, parsed.data);
      return c.json(result, 202);
    },
  )
  .delete(
    "/:name/email",
    requireAuth,
    async (c: Ctx) => {
      const name = c.req.param("name");
      if (!name) throw new HttpError("domainName is required", 422);

      const result = await removeEmail(c.var.user.id, name);
      return c.json(result, 202);
    },
  );
