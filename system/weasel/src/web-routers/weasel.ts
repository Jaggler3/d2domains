import { Hono } from "hono";
import { weaselController } from "../controllers/weasel.controller";

export const weaselRouter = new Hono();

weaselRouter.post("/orders", (c) => weaselController.createOrder(c));
weaselRouter.patch("/orders/:id", (c) => weaselController.patchOrder(c));
weaselRouter.get("/orders", (c) => weaselController.listOrders(c));
weaselRouter.get("/orders/:id", (c) => weaselController.getOrder(c));
weaselRouter.post("/domains", (c) => weaselController.createDomain(c));
weaselRouter.get("/domains", (c) => weaselController.listDomains(c));
weaselRouter.get("/domains/:domainName", (c) => weaselController.getDomain(c));
