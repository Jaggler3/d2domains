import { createMiddleware } from "hono/factory";

export function requireInternalToken(token: string) {
  return createMiddleware(async (c, next) => {
    if (c.req.header("x-internal-token") !== token) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  });
}
