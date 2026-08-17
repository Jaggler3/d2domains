import { describe, expect, test } from "bun:test";
import {
  createProvisioningProcessor,
  type DesiredDnsRecord,
  type ProvisioningDeps,
} from "./provisioning";
import { HttpError } from "../lib/http";

function order(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "order-1",
    userId: "user-1",
    domainName: "example.com",
    years: 1,
    purchaseType: "registration",
    priceCents: 1499,
    totalCents: 4498,
    paymentMethodId: null,
    addons: [{ type: "email", plan: "starter", mailboxes: 1, years: 1, priceCents: 2999 }],
    currency: "usd",
    status: "purchased",
    error: null,
    idempotencyKey: "user-1:example.com",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const DESIRED: DesiredDnsRecord[] = [
  { type: "MX", name: "@", value: "mail.example-mail.com", priority: 10, ttl: 3600 },
  { type: "TXT", name: "@", value: "v=spf1 include:example-mail.com ~all", ttl: 3600 },
  { type: "TXT", name: "_dkim", value: "v=DKIM1; k=rsa; p=REPLACE_WITH_PUBLIC_KEY", ttl: 3600 },
  { type: "TXT", name: "_dmarc", value: "v=DMARC1; p=none", ttl: 3600 },
];

function makeDeps(overrides: Partial<ProvisioningDeps> = {}): {
  deps: ProvisioningDeps;
  calls: {
    mailboxes: string[];
    dns: DesiredDnsRecord[];
    began: boolean;
    marked: boolean;
    errors: string[];
  };
} {
  const calls = { mailboxes: [] as string[], dns: [] as DesiredDnsRecord[], began: false, marked: false, errors: [] as string[] };
  const deps: ProvisioningDeps = {
    getOrder: async () => order(),
    getProvisioning: async () => null,
    beginProvisioning: async () => {
      calls.began = true;
    },
    createMailbox: async (_orderId, address) => {
      calls.mailboxes.push(address);
    },
    listDnsRecords: async () => [],
    createDnsRecord: async (_domain, _userId, record) => {
      calls.dns.push(record);
    },
    markProvisioned: async () => {
      calls.marked = true;
    },
    recordError: async (_orderId, message) => {
      calls.errors.push(message);
    },
    desiredRecords: () => DESIRED,
    mailboxAddress: (domainName) => `admin@${domainName}`,
    ...overrides,
  };
  return { deps, calls };
}

describe("provisioning saga", () => {
  test("provisions mailbox + 4 DNS records and marks provisioned on a purchased order", async () => {
    const { deps, calls } = makeDeps();
    const process = createProvisioningProcessor(deps);

    const result = await process("order-1");

    expect(result).toEqual({ status: "provisioned", reason: "provisioned" });
    expect(calls.began).toBe(true);
    expect(calls.mailboxes).toEqual(["admin@example.com"]);
    expect(calls.dns.map((r) => `${r.type}:${r.name}`)).toEqual([
      "MX:@",
      "TXT:@",
      "TXT:_dkim",
      "TXT:_dmarc",
    ]);
    expect(calls.marked).toBe(true);
  });

  test("retries when the order is not purchased yet", async () => {
    const { deps } = makeDeps({
      getOrder: async () => order({ status: "pending" }),
    });
    const process = createProvisioningProcessor(deps);

    expect(process("order-1")).rejects.toThrow(/not purchased yet/);
  });

  test("swallows when the order failed (never provision)", async () => {
    const { deps, calls } = makeDeps({
      getOrder: async () => order({ status: "failed" }),
    });
    const process = createProvisioningProcessor(deps);

    const result = await process("order-1");

    expect(result).toEqual({ status: "terminal", reason: "order_failed" });
    expect(calls.began).toBe(false);
    expect(calls.mailboxes).toEqual([]);
    expect(calls.marked).toBe(false);
  });

  test("swallows when the order is gone (404)", async () => {
    const { deps, calls } = makeDeps({
      getOrder: async () => {
        throw new HttpError("order not found", 404);
      },
    });
    const process = createProvisioningProcessor(deps);

    const result = await process("order-1");

    expect(result).toEqual({ status: "terminal", reason: "order_not_found" });
    expect(calls.began).toBe(false);
  });

  test("rethrows transient weasel failures", async () => {
    const { deps } = makeDeps({
      getOrder: async () => {
        throw new HttpError("domains service unavailable", 503);
      },
    });
    const process = createProvisioningProcessor(deps);

    expect(process("order-1")).rejects.toThrow("domains service unavailable");
  });

  test("skips orders without email addons", async () => {
    const { deps, calls } = makeDeps({
      getOrder: async () => order({ addons: [] }),
    });
    const process = createProvisioningProcessor(deps);

    const result = await process("order-1");

    expect(result).toEqual({ status: "skipped", reason: "no_email_addons" });
    expect(calls.began).toBe(false);
  });

  test("ignores non-email addon lines", async () => {
    const { deps, calls } = makeDeps({
      getOrder: async () =>
        order({ addons: [{ type: "hosting", plan: "x", mailboxes: 0, years: 1, priceCents: 100 }] }),
    });
    const process = createProvisioningProcessor(deps);

    const result = await process("order-1");

    expect(result).toEqual({ status: "skipped", reason: "no_email_addons" });
    expect(calls.began).toBe(false);
  });

  test("no-ops when already provisioned", async () => {
    const { deps, calls } = makeDeps({
      getProvisioning: async () => ({ status: "provisioned", error: null }),
    });
    const process = createProvisioningProcessor(deps);

    const result = await process("order-1");

    expect(result).toEqual({ status: "provisioned", reason: "already_provisioned" });
    expect(calls.began).toBe(false);
    expect(calls.mailboxes).toEqual([]);
    expect(calls.dns).toEqual([]);
    expect(calls.marked).toBe(false);
  });

  test("resumes partial work: skips existing records, still marks provisioned", async () => {
    const { deps, calls } = makeDeps({
      listDnsRecords: async () => [
        { type: "MX", name: "@" },
        { type: "TXT", name: "@" },
      ],
    });
    const process = createProvisioningProcessor(deps);

    const result = await process("order-1");

    expect(result).toEqual({ status: "provisioned", reason: "provisioned" });
    expect(calls.dns.map((r) => `${r.type}:${r.name}`)).toEqual([
      "TXT:_dkim",
      "TXT:_dmarc",
    ]);
    expect(calls.marked).toBe(true);
  });

  test("dedupes mailbox when multiple email addon lines", async () => {
    const { deps, calls } = makeDeps({
      getOrder: async () =>
        order({
          addons: [
            { type: "email", plan: "starter", mailboxes: 1, years: 1, priceCents: 2999 },
            { type: "email", plan: "starter", mailboxes: 1, years: 1, priceCents: 2999 },
          ],
        }),
    });
    const process = createProvisioningProcessor(deps);

    const result = await process("order-1");

    expect(result).toEqual({ status: "provisioned", reason: "provisioned" });
    expect(calls.mailboxes).toEqual(["admin@example.com"]);
  });

  test("terminal otter error is swallowed and recorded", async () => {
    const { deps, calls } = makeDeps({
      createDnsRecord: async () => {
        throw new HttpError("zone belongs to another user", 403);
      },
    });
    const process = createProvisioningProcessor(deps);

    const result = await process("order-1");

    expect(result).toEqual({ status: "terminal", reason: "provisioning_failed" });
    expect(calls.errors.length).toBe(1);
    expect(calls.marked).toBe(false);
  });

  test("transient otter failure rethrows for retry", async () => {
    const { deps } = makeDeps({
      createDnsRecord: async () => {
        throw new HttpError("dns service unavailable", 503);
      },
    });
    const process = createProvisioningProcessor(deps);

    expect(process("order-1")).rejects.toThrow("dns service unavailable");
  });
});