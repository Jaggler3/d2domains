export function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes))
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 20);
}

export function mailboxLocalPart(index: number): string {
  return index === 1 ? "admin" : `user${index}`;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

/** Extracts `{selector, publicKey}` from a Stalwart DKIM response, defensively. */
export function extractDkim(data: Record<string, unknown>): {
  selector: string;
  publicKey: string;
} | null {
  const publicKey =
    pickString(data, ["publicKey", "public_key", "p", "txt"]) ?? null;
  if (!publicKey) return null;
  return { selector: pickString(data, ["selector", "selectorName"]) ?? "default", publicKey };
}
