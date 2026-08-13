import type { Context } from "hono";
import { z } from "zod";
import { searchDomains } from "../services/domain.service";
import { HttpError } from "../lib/http";
import type { AuthVariables } from "../middleware/auth";

const searchSchema = z.object({
  keyword: z.string().min(1).max(100),
  tldFilter: z.array(z.string().max(20)).max(10).optional(),
});

export const domainsController = {
  async search(c: Context<{ Variables: AuthVariables }>) {
    const body = await c.req.json().catch(() => null);
    const parsed = searchSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError("invalid search query", 422, parsed.error.flatten());
    }
    const { user } = c.var;
    const results = await searchDomains(parsed.data, user.id);
    return c.json({ results });
  },
};
