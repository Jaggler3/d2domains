import { Hono } from "hono";
import { createRegistryController } from "../controllers/registry.controller";
import type { Redis } from "ioredis";

export function createRegistryRouter(redis: Redis) {
  const controller = createRegistryController(redis);
  const router = new Hono();

  router.post("/search", (c) => controller.search(c));
  router.post("/check-availability", (c) => controller.checkAvailability(c));
  router.post("/register", (c) => controller.register(c));

  router.get("/dns/:domainName/records", (c) => controller.listDnsRecords(c));
  router.post("/dns/:domainName/records", (c) => controller.createDnsRecord(c));
  router.put("/dns/:domainName/records/:recordId", (c) => controller.updateDnsRecord(c));
  router.delete("/dns/:domainName/records/:recordId", (c) => controller.deleteDnsRecord(c));;

  return router;
}
