import { Hono } from "hono";
import { wombatController } from "../controllers/wombat.controller";

export const wombatRouter = new Hono();

wombatRouter.post("/charges", (c) => wombatController.createCharge(c));
wombatRouter.post("/charges/:id/refund", (c) => wombatController.refundCharge(c));

wombatRouter.post("/payment-methods", (c) => wombatController.createPaymentMethod(c));
wombatRouter.get("/payment-methods", (c) => wombatController.listPaymentMethods(c));
wombatRouter.post("/payment-methods/:id/default", (c) => wombatController.setDefaultPaymentMethod(c));
wombatRouter.delete("/payment-methods/:id", (c) => wombatController.deletePaymentMethod(c));
