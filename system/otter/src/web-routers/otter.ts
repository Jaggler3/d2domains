import { Hono } from "hono";
import { otterController } from "../controllers/otter.controller";

export const otterRouter = new Hono();

otterRouter.get("/zones/:domainName/records", (c) => otterController.listRecords(c));
otterRouter.post("/zones/:domainName/records", (c) => otterController.createRecord(c));
otterRouter.patch("/zones/:domainName/records/:recordId", (c) => otterController.updateRecord(c));
otterRouter.delete("/zones/:domainName/records/:recordId", (c) => otterController.deleteRecord(c));
