import { Hono } from "hono";
import { wombatController } from "../controllers/wombat.controller";

export const wombatRouter = new Hono();

wombatRouter.post("/charges", (c) => wombatController.createCharge(c));
