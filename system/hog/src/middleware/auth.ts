import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { Session, User } from "../db/schema";
import { authService } from "../services/auth.service";

export const SESSION_COOKIE = "hog_session";

export type AuthVariables = {
  user: User;
  session: Session;
};

export function sessionCookie(
  token: string,
  expiresAt: Date,
  secure: boolean,
): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${
    secure ? "; Secure" : ""
  }`;
}

export const requireAuth: MiddlewareHandler<{ Variables: AuthVariables }> =
  async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    const found = await authService.findSession(token);
    if (!found) {
      return c.json({ error: "unauthorized" }, 401);
    }
    c.set("user", found.user);
    c.set("session", found.session);
    await next();
  };
