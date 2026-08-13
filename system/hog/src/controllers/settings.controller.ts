import type { Context } from "hono";
import { z } from "zod";
import { settingsService } from "../services/settings.service";
import { HttpError } from "../lib/http";
import type { AuthVariables } from "../middleware/auth";

const patchSchema = z.object({
  autorenew: z.boolean().optional(),
  privacy: z.boolean().optional(),
  locked: z.boolean().optional(),
  nameservers: z.array(z.string().min(1).max(253)).min(1).max(13).optional(),
});

export const settingsController = {
  async get(c: Context<{ Variables: AuthVariables }>) {
    const domainName = c.req.param("domainName");
    if (!domainName) throw new HttpError("domainName is required", 422);
    const domain = await settingsService.get(c.var.user.id, domainName);
    return c.json({ domain });
  },

  async patch(c: Context<{ Variables: AuthVariables }>) {
    const domainName = c.req.param("domainName");
    if (!domainName) throw new HttpError("domainName is required", 422);
    const body = await c.req.json().catch(() => null);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) throw new HttpError("invalid settings", 422);
    if (Object.keys(parsed.data).length === 0) {
      throw new HttpError("nothing to update", 422);
    }
    const domain = await settingsService.patch(c.var.user.id, domainName, parsed.data);
    return c.json({ domain });
  },
};
