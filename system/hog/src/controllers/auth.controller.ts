import type { Context } from "hono";
import { z } from "zod";
import { authService } from "../services/auth.service";
import { HttpError } from "../lib/http";
import { SESSION_COOKIE, sessionCookie, type AuthVariables } from "../middleware/auth";
import { loadEnv } from "../config/env";

const env = loadEnv();

const credentialsSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(8),
});

function setSessionCookie(c: Context, token: string, expiresAt: Date) {
  c.header("Set-Cookie", sessionCookie(token, expiresAt, env.COOKIE_SECURE));
}

export const authController = {
  async register(c: Context) {
    const body = await c.req.json().catch(() => null);
    const parsed = credentialsSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError("invalid credentials", 422, parsed.error.flatten());
    }
    const { user, session } = await authService.register(
      parsed.data.email,
      parsed.data.password,
    );
    setSessionCookie(c, session.token, session.expiresAt);
    return c.json({ user });
  },

  async login(c: Context) {
    const body = await c.req.json().catch(() => null);
    const parsed = credentialsSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError("invalid email or password", 401);
    }
    const { user, session } = await authService.login(
      parsed.data.email,
      parsed.data.password,
    );
    setSessionCookie(c, session.token, session.expiresAt);
    return c.json({ user });
  },

  async logout(c: Context) {
    const token = c.req.raw.headers.get("cookie") ?? undefined;
    await authService.logout(
      token
        ?.split(";")
        .map((p) => p.trim())
        .find((p) => p.startsWith(`${SESSION_COOKIE}=`))
        ?.slice(SESSION_COOKIE.length + 1),
    );
    c.header(
      "Set-Cookie",
      `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    );
    return c.json({ ok: true });
  },

  async me(c: Context<{ Variables: AuthVariables }>) {
    const { user } = c.var;
    return c.json({
      user: { id: user.id, email: user.email, createdAt: user.createdAt },
    });
  },
};
