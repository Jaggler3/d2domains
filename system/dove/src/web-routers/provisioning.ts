import { Hono } from "hono";
import { ProvisioningService } from "../services/provisioning.service";

export const provisioningRouter = new Hono<{
  Bindings: {
    provisioningService: ProvisioningService;
  };
}>().post(
  "/internal/provision",
  async (c) => {
    const { orderId } = await c.req.json();
    if (!orderId) return c.json({ error: "orderId required" }, 400);

    const result = await c.get("provisioningService").provision(orderId);
    return c.json(result);
  },
);

export const mailboxRouter = new Hono<{
  Bindings: {
    provisioningService: ProvisioningService;
  };
}>().get(
  "/internal/mailbox",
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
