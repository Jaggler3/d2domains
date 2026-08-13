import type { Context } from "hono";
import { z } from "zod";
import { searchDomains } from "../services/domain.service";
import { HttpError } from "../lib/http";
import { clientIp } from "../lib/ip";

const searchSchema = z.object({
  keyword: z.string().min(1).max(100),
  tldFilter: z.array(z.string().max(20)).max(10).optional(),
});

export const domainsController = {
  async search(c: Context) {
    const body = await c.req.json().catch(() => null);
    const parsed = searchSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError("invalid search query", 422, parsed.error.flatten());
    }
    const results = await searchDomains(parsed.data, clientIp(c));
    return c.json({ results });
  },
};
