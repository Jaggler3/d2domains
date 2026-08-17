import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { eq } from "drizzle-orm";
import { createProvisioningProcessor, type DesiredDnsRecord } from "./provisioning";
import { createWeaselClient, type AddonLine, type Order } from "../adapters/weasel";
import { createOtterClient } from "../adapters/otter";
import { db } from "../db/client";
import { mailboxes, provisioning } from "../db/schema";
import { loadEnv } from "../config/env";

const env = loadEnv();

export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

const weasel = createWeaselClient({
  baseUrl: env.WEASEL_URL,
  internalToken: env.INTERNAL_TOKEN,
});

const otter = createOtterClient({
  baseUrl: env.OTTER_URL,
  internalToken: env.INTERNAL_TOKEN,
});

function desiredRecords(): DesiredDnsRecord[] {
  return [
    {
      type: "MX",
      name: "@",
      value: env.MAIL_HOST,
      priority: env.MAIL_MX_PRIORITY,
      ttl: env.DNS_TTL,
    },
    { type: "TXT", name: "@", value: env.MAIL_SPF_TXT, ttl: env.DNS_TTL },
    { type: "TXT", name: "_dkim", value: env.MAIL_DKIM_TXT, ttl: env.DNS_TTL },
    { type: "TXT", name: "_dmarc", value: env.MAIL_DMARC_TXT, ttl: env.DNS_TTL },
  ];
}

const deps = {
  async getOrder(orderId: string): Promise<Order> {
    const { order } = await weasel.getOrder(orderId);
    return order;
  },
  async getProvisioning(orderId: string) {
    const row = await db.query.provisioning.findFirst({
      where: eq(provisioning.orderId, orderId),
    });
    return row ? { status: row.status, error: row.error } : null;
  },
  async beginProvisioning(
    orderId: string,
    input: { userId: string; domainName: string; addons: AddonLine[] },
  ) {
    const existing = await db.query.provisioning.findFirst({
      where: eq(provisioning.orderId, orderId),
    });
    if (existing) {
      if (existing.status === "failed") {
        await db
          .update(provisioning)
          .set({ status: "provisioning", error: null, updatedAt: new Date() })
          .where(eq(provisioning.id, existing.id));
      }
      return;
    }
    await db.insert(provisioning).values({
      orderId,
      userId: input.userId,
      domainName: input.domainName,
      addons: input.addons,
    });
  },
  async createMailbox(orderId: string, address: string) {
    await db
      .insert(mailboxes)
      .values({ orderId, address })
      .onConflictDoNothing();
  },
  async listDnsRecords(domainName: string, userId: string) {
    const { records } = await otter.listRecords(domainName, userId);
    return records.map((r) => ({ type: r.type, name: r.name }));
  },
  async createDnsRecord(
    domainName: string,
    userId: string,
    record: DesiredDnsRecord,
  ) {
    await otter.createRecord(domainName, userId, record);
  },
  async markProvisioned(orderId: string) {
    await db
      .update(provisioning)
      .set({ status: "provisioned", error: null, updatedAt: new Date() })
      .where(eq(provisioning.orderId, orderId));
  },
  async recordError(orderId: string, message: string) {
    await db
      .update(provisioning)
      .set({ error: message, updatedAt: new Date() })
      .where(eq(provisioning.orderId, orderId));
  },
  desiredRecords,
  mailboxAddress(domainName: string) {
    return `admin@${domainName}`;
  },
};

export const processProvisioningJob = createProvisioningProcessor(deps);

export function startEmailWorker(): Worker {
  const worker = new Worker(
    "email-jobs",
    async (job) => {
      const { orderId } = job.data as { orderId?: unknown };
      if (typeof orderId !== "string" || orderId.length === 0) {
        throw new Error(`email job ${job.id ?? "?"} missing orderId`);
      }
      
      // Call dove provisioning instead of internal processProvisioningJob
      const doveUrl = env.DOVE_URL || "http://localhost:8786";
      const res = await fetch(`${doveUrl}/internal/provision`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": env.INTERNAL_TOKEN,
        },
        body: JSON.stringify({ orderId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(`dove provisioning failed: ${data.error ?? res.statusText}`);
      }
    },
    {
      connection: redis,
      concurrency: 5,
    },
  );

  worker.on("failed", (job, err) => {
    console.error(
      `[pigeon] email job ${job?.id ?? "?"} failed (will retry):`,
      err,
    );
  });

  return worker;
}