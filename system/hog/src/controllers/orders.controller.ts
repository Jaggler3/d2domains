import type { Context } from "hono";
import { z } from "zod";
import { buyDomain, getOrder, listDomains, listOrders } from "../services/orders.service";
import { HttpError } from "../lib/http";
import type { AuthVariables } from "../middleware/auth";

const buySchema = z.object({
  domainName: z.string().min(1).max(253),
  years: z.number().int().min(1).max(10).optional(),
});

export const ordersController = {
  async buy(c: Context<{ Variables: AuthVariables }>) {
    const body = await c.req.json().catch(() => null);
    const parsed = buySchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError("invalid buy request", 422, parsed.error.flatten());
    }
    const order = await buyDomain(c.var.user.id, parsed.data);
    return c.json({ order }, 202);
  },

  async list(c: Context<{ Variables: AuthVariables }>) {
    const domains = await listDomains(c.var.user.id);
    return c.json({ domains });
  },

  async order(c: Context<{ Variables: AuthVariables }>) {
    const id = c.req.param("id");
    if (!id) throw new HttpError("order id is required", 422);
    const order = await getOrder(c.var.user.id, id);
    return c.json({ order });
  },

  async listOrders(c: Context<{ Variables: AuthVariables }>) {
    const orders = await listOrders(c.var.user.id);
    return c.json({ orders });
  },
};
