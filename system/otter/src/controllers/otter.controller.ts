import type { Context } from "hono";
import { z } from "zod";
import { otterService, RECORD_TYPES } from "../services/otter.service";
import { HttpError } from "../lib/http";

function userIdOf(c: Context): string {
  const userId = c.req.query("userId");
  if (!userId) throw new HttpError("userId is required", 422);
  return userId;
}

function domainNameOf(c: Context): string {
  const name = c.req.param("domainName");
  if (!name) throw new HttpError("domainName is required", 422);
  return name.toLowerCase();
}

const recordSchema = z.object({
  type: z.enum(RECORD_TYPES),
  name: z.string().min(1).max(253),
  value: z.string().min(1).max(4096),
  ttl: z.number().int().positive().max(86400).optional(),
  priority: z.number().int().min(0).max(65535).nullable().optional(),
});

const patchSchema = recordSchema.partial();

export const otterController = {
  async listRecords(c: Context) {
    const { zone, records } = await otterService.listRecords(
      userIdOf(c),
      domainNameOf(c),
    );
    return c.json({ zone, records });
  },

  async createRecord(c: Context) {
    const body = await c.req.json().catch(() => null);
    const parsed = recordSchema.safeParse(body);
    if (!parsed.success) throw new HttpError("invalid record", 422);
    const record = await otterService.createRecord(userIdOf(c), domainNameOf(c), parsed.data);
    return c.json({ record }, 201);
  },

  async updateRecord(c: Context) {
    const recordId = c.req.param("recordId");
    if (!recordId) throw new HttpError("recordId is required", 422);
    const body = await c.req.json().catch(() => null);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) throw new HttpError("invalid record", 422);
    const record = await otterService.updateRecord(
      userIdOf(c),
      domainNameOf(c),
      recordId,
      parsed.data,
    );
    return c.json({ record });
  },

  async deleteRecord(c: Context) {
    const recordId = c.req.param("recordId");
    if (!recordId) throw new HttpError("recordId is required", 422);
    await otterService.deleteRecord(userIdOf(c), domainNameOf(c), recordId);
    return c.body(null, 204);
  },
};
