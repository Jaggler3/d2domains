import type { Context } from "hono";
import { getConnInfo } from "hono/bun";

export function clientIp(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const address = getConnInfo(c).remote?.address;
  return address ?? "unknown";
}
