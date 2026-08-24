import { Hono } from "hono";
import { loadEnv } from "../config/env";
import { HttpError } from "../lib/http";

const env = loadEnv();

export const emailRouter = new Hono()
  .get("/:name/email", async (c) => {
    const name = c.req.param("name");
    // ownership check would normally be here via weasel
    
    const doveUrl = env.DOVE_URL || "http://localhost:8786";
    const userId = "unknown"; // In real app, extracted from session
    
    const res = await fetch(`${doveUrl}/internal/mailbox?domainName=${encodeURIComponent(name)}&userId=${encodeURIComponent(userId)}`, {
      headers: {
        "x-internal-token": env.INTERNAL_TOKEN,
      },
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new HttpError(data?.error ?? "dove error", res.status);
    }

    return c.json(await res.json());
  });
