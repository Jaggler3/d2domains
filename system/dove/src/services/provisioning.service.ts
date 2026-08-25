import { db } from "../db/client";
import { domains, mailboxes, provisioning, accounts, emails } from "../db/schema";
import type { StalwartClient } from "../adapters/stalwart";
import type { WeaselClient } from "../adapters/weasel";
import type { OtterClient } from "../adapters/otter";
import { HttpError } from "../lib/http";
import { randomPassword, mailboxLocalPart } from "../lib/mailbox";
import { eq, and } from "drizzle-orm";

export interface ProvisioningServiceDeps {
  stalwart: StalwartClient;
  weasel: WeaselClient;
  otter: OtterClient;
  mailHost: string;
  mxPriority: number;
}

export interface MailboxCredential {
  address: string;
  password: string;
}

export type ProvisioningService = ReturnType<typeof createProvisioningService>;

const MAX_MAILBOXES = 100;

export function createProvisioningService(deps: ProvisioningServiceDeps) {
  const { stalwart, weasel, otter, mailHost, mxPriority } = deps;

  async function ensureDomainRow(orderId: string, domainName: string, userId: string) {
    const byOrder = await db.query.domains.findFirst({
      where: eq(domains.orderId, orderId),
    });
    if (byOrder) return byOrder;

    await db
      .insert(domains)
      .values({ id: crypto.randomUUID(), domainName, userId, orderId })
      .onConflictDoNothing({ target: domains.domainName });

    const row = await db.query.domains.findFirst({
      where: eq(domains.domainName, domainName),
    });
    if (!row) throw new HttpError(`could not create domain row for ${domainName}`, 500);
    return row;
  }

  async function createMailbox(
    orderId: string,
    domainRow: { id: string; domainName: string },
    userId: string,
    index: number,
  ): Promise<MailboxCredential> {
    const address = `${mailboxLocalPart(index)}@${domainRow.domainName}`;

    const existing = await db.query.mailboxes.findFirst({
      where: and(eq(mailboxes.orderId, orderId), eq(mailboxes.address, address)),
    });
    if (existing) {
      return { address: existing.address, password: existing.secret };
    }

    const password = randomPassword();
    const secretHash = await Bun.password.hash(password, { algorithm: "argon2id" });
    const accountName = address;

    // Stalwart SQL directory tables — it reads these for auth/routing.
    await db
      .insert(accounts)
      .values({
        name: accountName,
        secret: secretHash,
        description: `d2domains mailbox for ${domainRow.domainName}`,
        type: "individual",
      })
      .onConflictDoNothing({ target: accounts.name });

    const existingEmail = await db.query.emails.findFirst({
      where: and(eq(emails.name, accountName), eq(emails.address, address)),
    });
    if (!existingEmail) {
      await db.insert(emails).values({ name: accountName, address, type: "primary" });
    }

    await db
      .insert(mailboxes)
      .values({
        id: crypto.randomUUID(),
        domainId: domainRow.id,
        userId,
        address,
        accountName,
        secret: password,
        orderId,
      })
      .onConflictDoNothing({ target: mailboxes.address });

    return { address, password };
  }

  async function publishDnsRecords(
    domainName: string,
    userId: string,
    dkim: { selector: string; publicKey: string },
  ) {
    const desired = [
      { type: "MX", name: "@", value: mailHost, priority: mxPriority },
      { type: "TXT", name: "@", value: `v=spf1 mx a:${mailHost} -all` },
      {
        type: "TXT",
        name: `${dkim.selector}._domainkey`,
        value: `v=DKIM1; k=rsa; p=${dkim.publicKey}`,
      },
      { type: "TXT", name: "_dmarc", value: "v=DMARC1; p=reject;" },
    ];

    const { records } = await otter.listRecords(domainName, userId);
    const existing = new Set((records ?? []).map((r) => `${r.type}:${r.name}`));

    for (const rec of desired) {
      if (existing.has(`${rec.type}:${rec.name}`)) continue;
      await otter.createRecord(domainName, userId, rec);
    }
  }

  async function provision(orderId: string) {
    const existing = await db.query.provisioning.findFirst({
      where: eq(provisioning.orderId, orderId),
    });

    if (existing?.status === "provisioned") {
      return { status: "already_provisioned" };
    }

    const order = await weasel.getOrder(orderId);
    if (order.status !== "purchased") {
      throw new HttpError(`order ${orderId} not purchased (status=${order.status})`, 400);
    }

    const emailAddons = (order.addons ?? []).filter((a) => a.type === "email");
    if (emailAddons.length === 0) {
      return { status: "skipped", reason: "no_email_addons" };
    }
    const mailboxCount = Math.min(
      MAX_MAILBOXES,
      Math.max(1, emailAddons.reduce((n, a) => n + Math.max(1, a.mailboxes ?? 1), 0)),
    );

    await db
      .insert(provisioning)
      .values({
        orderId,
        domainName: order.domainName,
        userId: order.userId,
        status: "pending",
      })
      .onConflictDoUpdate({
        target: provisioning.orderId,
        set: { status: "pending", error: null, updatedAt: new Date() },
      });

    try {
      const domainRow = await ensureDomainRow(orderId, order.domainName, order.userId);
      const stalwartDomain = await stalwart.ensureDomain(order.domainName);

      // DKIM: Stalwart holds the private key; we publish the public half.
      // Keys are generated asynchronously after domain creation, so poll
      // briefly before giving up (the job layer retries every few seconds).
      let dkim: { selector: string; publicKey: string } | null = null;
      for (let waited = 0; waited <= 15_000; waited += 2_000) {
        dkim = await stalwart.getActiveDkim(stalwartDomain.id);
        if (dkim) break;
        await new Promise((r) => setTimeout(r, 2_000));
      }
      if (!dkim) {
        throw new HttpError("stalwart dkim key not ready yet", 503);
      }

      const credentials: MailboxCredential[] = [];
      for (let i = 1; i <= mailboxCount; i++) {
        credentials.push(await createMailbox(orderId, domainRow, order.userId, i));
      }

      await publishDnsRecords(order.domainName, order.userId, dkim);

      await db
        .update(domains)
        .set({
          status: "active",
          dnsPublished: true,
          stalwartDomainId: stalwartDomain.id,
          updatedAt: new Date(),
        })
        .where(eq(domains.id, domainRow.id));

      await db
        .update(provisioning)
        .set({ status: "provisioned", error: null, updatedAt: new Date() })
        .where(eq(provisioning.orderId, orderId));

      return { status: "provisioned", primary: credentials[0], mailboxes: credentials };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(provisioning)
        .set({ status: "failed", error: message, updatedAt: new Date() })
        .where(eq(provisioning.orderId, orderId));
      throw err;
    }
  }

  async function getMailbox(domainName: string, userId: string) {
    const rows = await db
      .select({ mailbox: mailboxes })
      .from(mailboxes)
      .innerJoin(domains, eq(mailboxes.domainId, domains.id))
      .where(and(eq(domains.domainName, domainName), eq(mailboxes.userId, userId)));

    const primary = rows[0]?.mailbox;
    if (!primary) throw new HttpError("mailbox not found", 404);

    return {
      address: primary.address,
      password: primary.secret,
      imapHost: mailHost,
      imapPort: 993,
      smtpHost: mailHost,
      smtpPort: 587,
      mailboxes: rows.map((r) => ({ address: r.mailbox.address, password: r.mailbox.secret })),
    };
  }

  return { provision, getMailbox };
}
