import type { AddonLine, Order } from "../adapters/weasel";

export interface ProvisionJobPayload {
  orderId: string;
}

export interface DesiredDnsRecord {
  type: string;
  name: string;
  value: string;
  ttl: number;
  priority?: number | null;
}

export type ProvisionOutcome =
  | { status: "provisioned"; reason: "provisioned" | "already_provisioned" }
  | { status: "skipped"; reason: "no_email_addons" }
  | { status: "terminal"; reason: "order_not_found" | "order_failed" | "provisioning_failed" };

export interface ProvisioningDeps {
  getOrder(orderId: string): Promise<Order>;
  getProvisioning(
    orderId: string,
  ): Promise<{ status: string; error: string | null } | null>;
  beginProvisioning(
    orderId: string,
    input: { userId: string; domainName: string; addons: AddonLine[] },
  ): Promise<void>;
  createMailbox(orderId: string, address: string): Promise<void>;
  listDnsRecords(
    domainName: string,
    userId: string,
  ): Promise<{ type: string; name: string }[]>;
  createDnsRecord(
    domainName: string,
    userId: string,
    record: DesiredDnsRecord,
  ): Promise<void>;
  markProvisioned(orderId: string): Promise<void>;
  recordError(orderId: string, message: string): Promise<void>;
  desiredRecords(): DesiredDnsRecord[];
  mailboxAddress(domainName: string): string;
}

function isTerminal(err: unknown): boolean {
  if (err instanceof Error && "status" in err) {
    const status = (err as { status?: unknown }).status;
    if (typeof status === "number") {
      return status >= 400 && status < 500 && status !== 429;
    }
  }
  return false;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createProvisioningProcessor(deps: ProvisioningDeps) {
  return async function processProvisioning(
    orderId: string,
  ): Promise<ProvisionOutcome> {
    let order: Order;
    try {
      order = await deps.getOrder(orderId);
    } catch (err) {
      if (isTerminal(err)) {
        console.error(
          `[pigeon] order ${orderId} not found, skipping provisioning:`,
          err,
        );
        return { status: "terminal", reason: "order_not_found" };
      }
      throw err;
    }

    if (order.status === "failed") {
      console.log(`[pigeon] order ${orderId} failed, not provisioning email`);
      return { status: "terminal", reason: "order_failed" };
    }
    if (order.status !== "purchased") {
      throw new Error(
        `order ${orderId} not purchased yet (status=${order.status}), will retry`,
      );
    }

    const emailAddons = (order.addons ?? []).filter((a) => a.type === "email");
    if (emailAddons.length === 0) {
      console.log(`[pigeon] order ${orderId} has no email addons, skipping`);
      return { status: "skipped", reason: "no_email_addons" };
    }

    const existing = await deps.getProvisioning(orderId);
    if (existing?.status === "provisioned") {
      console.log(`[pigeon] order ${orderId} already provisioned, no-op`);
      return { status: "provisioned", reason: "already_provisioned" };
    }

    await deps.beginProvisioning(orderId, {
      userId: order.userId,
      domainName: order.domainName,
      addons: emailAddons,
    });

    try {
      const addresses = Array.from(
        new Set(emailAddons.map(() => deps.mailboxAddress(order.domainName))),
      );
      for (const address of addresses) {
        await deps.createMailbox(orderId, address);
      }

      const existingRecords = await deps.listDnsRecords(
        order.domainName,
        order.userId,
      );
      const have = new Set(existingRecords.map((r) => `${r.type}:${r.name}`));
      for (const record of deps.desiredRecords()) {
        if (have.has(`${record.type}:${record.name}`)) continue;
        await deps.createDnsRecord(order.domainName, order.userId, record);
      }

      await deps.markProvisioned(orderId);
      return { status: "provisioned", reason: "provisioned" };
    } catch (err) {
      if (isTerminal(err)) {
        await deps.recordError(orderId, messageOf(err)).catch(() => {});
        console.error(
          `[pigeon] terminal provisioning failure for order ${orderId}:`,
          err,
        );
        return { status: "terminal", reason: "provisioning_failed" };
      }
      throw err;
    }
  };
}