import { cache } from "react";
import { cookies } from "next/headers";

const HOG_URL = process.env.HOG_URL ?? "http://localhost:8787";

export interface SessionUser {
  id: string;
  email: string;
  createdAt: string;
}

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  try {
    const cookieStore = await cookies();
    const res = await fetch(`${HOG_URL}/api/v1/auth/me`, {
      headers: { cookie: cookieStore.toString() },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { user?: SessionUser };
    return data.user ?? null;
  } catch {
    return null;
  }
});
