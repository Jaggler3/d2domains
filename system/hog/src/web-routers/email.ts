import { Hono } from "hono";
import type { Context } from "hono";
import { loadEnv } from "../config/env";
import { HttpError } from "../lib/http";
import { requireAuth, type AuthVariables } from "../middleware/auth";
import { assertDomainOwnership } from "../services/ownership";

const env = loadEnv();

type Ctx = Context<{ Variables: AuthVariables }>;

export const emailRouter = new Hono<{ Variables: AuthVariables }>().get(
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
);
