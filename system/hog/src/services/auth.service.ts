import { and, eq, gt } from "drizzle-orm";
import { db } from "../db/client";
import { sessions, users, type Session, type User } from "../db/schema";
import { HttpError } from "../lib/http";
import { loadEnv } from "../config/env";

const env = loadEnv();

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return Bun.CryptoHasher.hash("sha256", token, "hex");
}

export interface SessionToken {
  token: string;
  expiresAt: Date;
}

async function createSession(userId: string): Promise<SessionToken> {
  const token = randomToken();
  const expiresAt = new Date(
    Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  await db
    .insert(sessions)
    .values({ userId, tokenHash: hashToken(token), expiresAt });
  return { token, expiresAt };
}

function publicUser(user: User) {
  return { id: user.id, email: user.email, createdAt: user.createdAt };
}

export const authService = {
  async register(email: string, password: string) {
    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      throw new HttpError("invalid email address", 422);
    }
    const existing = await db.query.users.findFirst({
      where: eq(users.email, normalized),
    });
    if (existing) {
      throw new HttpError("email already registered", 409);
    }
    const passwordHash = await Bun.password.hash(password, {
      algorithm: "argon2id",
    });
    const [user] = await db
      .insert(users)
      .values({ email: normalized, passwordHash })
      .returning();
    if (!user) throw new HttpError("failed to create user", 500);
    const session = await createSession(user.id);
    return { user: publicUser(user), session };
  },

  async login(email: string, password: string) {
    const normalized = email.trim().toLowerCase();
    const user = await db.query.users.findFirst({
      where: eq(users.email, normalized),
    });
    if (!user) throw new HttpError("invalid email or password", 401);
    const ok = await Bun.password.verify(password, user.passwordHash);
    if (!ok) throw new HttpError("invalid email or password", 401);
    const session = await createSession(user.id);
    return { user: publicUser(user), session };
  },

  async logout(token: string | undefined) {
    if (!token) return;
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  },

  async findSession(token: string | undefined): Promise<{
    user: User;
    session: Session;
  } | null> {
    if (!token) return null;
    const session = await db.query.sessions.findFirst({
      where: and(
        eq(sessions.tokenHash, hashToken(token)),
        gt(sessions.expiresAt, new Date()),
      ),
    });
    if (!session) return null;
    const user = await db.query.users.findFirst({
      where: eq(users.id, session.userId),
    });
    if (!user) return null;
    return { user, session };
  },
};
