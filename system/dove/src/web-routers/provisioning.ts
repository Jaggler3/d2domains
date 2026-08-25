import { Hono } from "hono";
import type { ProvisioningService } from "../services/provisioning.service";

type Vars = { provisioningService: ProvisioningService };

export const provisioningRouter = new Hono<{ Variables: Vars }>().post(
  "/provision",
  async (c) => {
    const { orderId } = await c.req.json();
    if (typeof orderId !== "string" || orderId.length === 0) {
      return c.json({ error: "orderId required" }, 400);
    }

    const result = await c.get("provisioningService").provision(orderId);
    return c.json(result);
  },
);

export const mailboxRouter = new Hono<{ Variables: Vars }>().get(
  "/mailbox",
  async (c) => {
    const domainName = c.req.query("domainName");
    const userId = c.req.query("userId");

    if (!domainName || !userId) {
      return c.json({ error: "domainName and userId required" }, 400);
    }

    const mailbox = await c.get("provisioningService").getMailbox(domainName, userId);
    return c.json(mailbox);
  },
);
