import { Hono } from "hono";
import { authController } from "../controllers/auth.controller";
import { requireAuth } from "../middleware/auth";

export const authRouter = new Hono();

authRouter.post("/register", (c) => authController.register(c));
authRouter.post("/login", (c) => authController.login(c));
authRouter.post("/logout", (c) => authController.logout(c));
authRouter.get("/me", requireAuth, (c) => authController.me(c));
