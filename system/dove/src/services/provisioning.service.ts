import { db } from "../db/client";
import { domains, mailboxes, provisioning, accounts, emails } from "../db/schema";
import { StalwartClient } from "../adapters/stalwart";
import { WeaselClient } from "../adapters/weasel";
import { OtterClient } from "../adapters/otter";
import { HttpError } from "../lib/http";
import { eq, and } from "drizzle-orm";

export interface ProvisioningServiceDeps {
  stalwart: StalwartClient;
  weasel: WeaselClient;
  otter: OtterClient;
  mailHost: string;
}

export function createProvisioningService(deps: ProvisioningServiceDeps) {
  const { stalwart, weasel, otter, mailHost } = deps;

  async function provision(orderId: string) {
    // 1. Check if already provisioned
    const existing = await db.query.provisioning.findFirst({
      where: eq(provisioning.orderId, orderId),
    });

    if (existing?.status === "provisioned") {
      return { status: "already_provisioned" };
    }

    // 2. Fetch order and verify
    const order = await weasel.getOrder(orderId);
    if (order.status !== "purchased") {
      throw new HttpError(`order ${orderId} not purchased (status=${order.status})`, 400);
    }

    const emailAddons = (order.addons ?? []).filter((a) => a.type === "email");
    if (emailAddons.length === 0) {
      return { status: "skipped", reason: "no_email_addons" };
    }

    // 3. Record start of provisioning
    await db.insert(provisioning).values({
      orderId,
      domainName: order.domainName,
      userId: order.userId,
      status: "pending",
    }).onConflictDoUpdate({
      target: provisioning.orderId,
      set: { status: "pending", updatedAt: new Date() },
    });

    try {
      // 4. Stalwart: Create Domain & DKIM
      // Assuming stalwart.call("domain.create", ...) and similar based on JMAP
      // In a real scenario, we'd use the specific Stalwart JMAP methods.
      // For now, we simulate the domain setup in Stalwart.
      const stalwartDomain = await stalwart.call("domain.create", {
        domain: order.domainName,
      });

      // 5. Create admin mailbox and aliases
      const password = Math.random().toString(36).slice(-12);
      const hashedSecret = `sha256:${password}`; // Simplified; Stalwart supports various hashes

      const accountName = `user_${order.userId}`;
      const adminEmail = `admin@${order.domainName}`;

      await db.insert(accounts).values({
        name: accountName,
        secret: hashedSecret,
        type: "individual",
      });

      await db.insert(emails).values({
        name: accountName,
        address: adminEmail,
        type: "primary",
      });

      await db.insert(mailboxes).values({
        id: crypto.randomUUID(),
        domainId: stalwartDomain.id || order.domainName,
        userId: order.userId,
        address: adminEmail,
        accountName: accountName,
        secret: password,
        orderId,
      });

      // 6. DNS Records
      // We need MX, SPF, DKIM, DMARC
      const mxValue = mailHost;
      const spfValue = `v=spf1 mx ${mailHost} -all`;
      const dmarcValue = `v=DMARC1; p=reject;`;
      
      // Get DKIM key from Stalwart
      const dkimData = await stalwart.call("domain.getDkim", { domain: order.domainName });
      const dkimValue = dkimData.publicKey;

      const records = [
        { type: "MX", name: "@", value: mxValue, priority: 10 },
        { type: "TXT", name: "@", value: spfValue },
        { type: "TXT", name: "_dmarc", value: dmarcValue },
        { type: "TXT", name: `_domainkey`, value: dkimValue },
      ];

      for (const rec of records) {
        await otter.createRecord(order.domainName, order.userId, {
          type: rec.type,
          name: rec.name === "@" ? "" : rec.name,
          value: rec.value,
          priority: rec.priority,
        });
      }

      // 7. Mark as provisioned
      await db.update(provisioning)
        .set({ status: "provisioned", updatedAt: new Date() })
        .where(eq(provisioning.orderId, orderId));

      return { status: "provisioned", password };
    } catch (err: any) {
      await db.update(provisioning)
        .set({ status: "failed", error: err.message, updatedAt: new Date() })
        .where(eq(provisioning.orderId, orderId));
      throw err;
    }
  }

  async function getMailbox(domainName: string, userId: string) {
    const mailbox = await db.query.mailboxes.findFirst({
      where: and(
        eq(mailboxes.userId, userId),
        (db, { sql }) => sql`exists (select 1 from dove_domains where domain_name = ${domainName} and id = ${mailboxes.domainId})`
      ),
    });

    if (!mailbox) throw new HttpError("mailbox not found", 404);

    return {
      address: mailbox.address,
      password: mailbox.secret,
      imapHost: mailHost,
      imapPort: 993,
      smtpHost: mailHost,
      smtpPort: 587,
    };
  }

  return { provision, getMailbox };
}
