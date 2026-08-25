export function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes))
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 20);
}

export function mailboxLocalPart(index: number): string {
  return index === 1 ? "admin" : `user${index}`;
}
