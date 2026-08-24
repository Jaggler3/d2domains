import { Hono } from "hono";
import { billingController } from "../controllers/billing.controller";
import { requireAuth } from "../middleware/auth";

export const billingRouter = new Hono();

billingRouter.get("/methods", requireAuth, (c) => billingController.listMethods(c));
billingRouter.post("/methods", requireAuth, (c) => billingController.addMethod(c));
billingRouter.post("/methods/setup-intent", requireAuth, (c) => billingController.createSetupIntent(c));
billingRouter.post("/methods/:id/default", requireAuth, (c) => billingController.setDefaultMethod(c));
billingRouter.delete("/methods/:id", requireAuth, (c) => billingController.deleteMethod(c));
