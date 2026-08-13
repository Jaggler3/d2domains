import type { Context } from "hono";
import { z } from "zod";
import { createRegistryClient, RegistryError } from "../adapters/namecom";
import { normalizeRegistryResults } from "../lib/registry-results";
import { createRateLimiter, type TokenBucketOptions } from "../services/rate-limit";
import type { Redis } from "ioredis";
import { loadEnv } from "../config/env";

const env = loadEnv();

const registry = createRegistryClient({
  baseUrl: env.NAME_COM_BASE,
  username: env.NAME_COM_USERNAME,
  token: env.NAME_COM_TOKEN,
});

const searchSchema = z.object({
  keyword: z.string().min(1).max(100),
  tldFilter: z.array(z.string().max(20)).max(10).optional(),
});

const checkSchema = z.object({
  domainNames: z.array(z.string().max(253)).min(1).max(50),
});

const registerSchema = z.object({
  domainName: z.string().min(1).max(253),
  purchasePrice: z.number().positive(),
  purchaseType: z.enum(["registration", "premium"]).default("registration"),
  years: z.number().int().min(1).max(10).default(1),
});

const dnsRecordSchema = z.object({
  type: z.string().min(1).max(16),
  host: z.string().min(1).max(253),
  answer: z.string().min(1).max(4096),
  ttl: z.number().int().positive().max(86400).optional(),
  priority: z.number().int().min(0).max(65535).nullable().optional(),
});

export class HeronError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HeronError";
  }
}

export function createRegistryController(redis: Redis) {
  const rateLimiter = createRateLimiter(redis);

  async function gate(c: Context): Promise<boolean> {
    const allowed = await rateLimiter.consume({
      burst: env.REGISTRY_RATE_BURST,
      refillPerSec: env.REGISTRY_RATE_REFILL,
      key: "registry:token-bucket",
    } satisfies TokenBucketOptions);
    if (!allowed) throw new HeronError("registry rate limit exceeded", 429);
    return allowed;
  }

  async function search(c: Context) {
    await gate(c);
    const body = await c.req.json().catch(() => null);
    const parsed = searchSchema.safeParse(body);
    if (!parsed.success) throw new HeronError("invalid search", 422);
    const tlds = (parsed.data.tldFilter ?? []).map((t) => t.replace(/^\./, "").toLowerCase());
    const raw = await registry.search(parsed.data.keyword, tlds);
    return c.json({ results: normalizeRegistryResults(raw.results) });
  }

  async function checkAvailability(c: Context) {
    await gate(c);
    const body = await c.req.json().catch(() => null);
    const parsed = checkSchema.safeParse(body);
    if (!parsed.success) throw new HeronError("invalid check", 422);
    const raw = await registry.checkAvailability(parsed.data.domainNames);
    return c.json({ results: normalizeRegistryResults(raw.results) });
  }

  async function register(c: Context) {
    await gate(c);
    const body = await c.req.json().catch(() => null);
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) throw new HeronError("invalid register", 422);
    const res = await registry.createDomain({
      domainName: parsed.data.domainName,
      purchasePrice: parsed.data.purchasePrice,
      purchaseType: parsed.data.purchaseType,
      years: parsed.data.years,
    });
    return c.json(
      {
        domainName: res.domain.domainName,
        orderId: String(res.order),
        totalPaid: res.totalPaid,
      },
      201,
    );
  }

  function domainNameOf(c: Context): string {
    const name = c.req.param("domainName");
    if (!name) throw new HeronError("domainName is required", 422);
    return name.toLowerCase();
  }

  async function listDnsRecords(c: Context) {
    await gate(c);
    const res = await registry.listDnsRecords(domainNameOf(c));
    return c.json({ records: res.records });
  }

  async function createDnsRecord(c: Context) {
    await gate(c);
    const body = await c.req.json().catch(() => null);
    const parsed = dnsRecordSchema.safeParse(body);
    if (!parsed.success) throw new HeronError("invalid dns record", 422);
    const res = await registry.createDnsRecord(domainNameOf(c), parsed.data);
    return c.json({ record: res.record }, 201);
  }

  async function updateDnsRecord(c: Context) {
    await gate(c);
    const recordId = c.req.param("recordId");
    if (!recordId) throw new HeronError("recordId is required", 422);
    const body = await c.req.json().catch(() => null);
    const parsed = dnsRecordSchema.safeParse(body);
    if (!parsed.success) throw new HeronError("invalid dns record", 422);
    const res = await registry.updateDnsRecord(domainNameOf(c), recordId, parsed.data);
    return c.json({ record: res.record });
  }

  async function deleteDnsRecord(c: Context) {
    await gate(c);
    const recordId = c.req.param("recordId");
    if (!recordId) throw new HeronError("recordId is required", 422);
    await registry.deleteDnsRecord(domainNameOf(c), recordId);
    return c.body(null, 204);
  }

  return { search, checkAvailability, register, listDnsRecords, createDnsRecord, updateDnsRecord, deleteDnsRecord };
}
