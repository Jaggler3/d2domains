import type { Context } from "hono";
import { z } from "zod";
import { dnsService } from "../services/dns.service";
import { HttpError } from "../lib/http";
import type { AuthVariables } from "../middleware/auth";

const recordSchema = z.object({
  type: z.enum(["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "CAA"]),
  name: z.string().min(1).max(253),
  value: z.string().min(1).max(4096),
  ttl: z.number().int().positive().max(86400).optional(),
  priority: z.number().int().min(0).max(65535).nullable().optional(),
});

const patchSchema = recordSchema.partial();

export const dnsController = {
  async list(c: Context<{ Variables: AuthVariables }>) {
    const domainName = c.req.param("domainName");
    if (!domainName) throw new HttpError("domainName is required", 422);
    const result = await dnsService.listRecords(c.var.user.id, domainName);
    return c.json(result);
  },

  async create(c: Context<{ Variables: AuthVariables }>) {
    const domainName = c.req.param("domainName");
    if (!domainName) throw new HttpError("domainName is required", 422);
    const body = await c.req.json().catch(() => null);
    const parsed = recordSchema.safeParse(body);
    if (!parsed.success) throw new HttpError("invalid record", 422);
    const record = await dnsService.createRecord(c.var.user.id, domainName, parsed.data);
    return c.json({ record }, 201);
  },

  async update(c: Context<{ Variables: AuthVariables }>) {
    const domainName = c.req.param("domainName");
    const recordId = c.req.param("recordId");
    if (!domainName || !recordId) throw new HttpError("missing params", 422);
    const body = await c.req.json().catch(() => null);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) throw new HttpError("invalid record", 422);
    const record = await dnsService.updateRecord(c.var.user.id, domainName, recordId, parsed.data);
    return c.json({ record });
  },

  async remove(c: Context<{ Variables: AuthVariables }>) {
    const domainName = c.req.param("domainName");
    const recordId = c.req.param("recordId");
    if (!domainName || !recordId) throw new HttpError("missing params", 422);
    await dnsService.deleteRecord(c.var.user.id, domainName, recordId);
    return c.body(null, 204);
  },
};
