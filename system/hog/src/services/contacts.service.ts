import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { users } from "../db/schema";
import { createRegistryClient } from "../adapters/registry";
import { loadEnv } from "../config/env";
import { contactInputForEmail } from "../lib/contact-identity";

let registryInstance: ReturnType<typeof createRegistryClient> | null = null;

function registry() {
  if (!registryInstance) {
    const env = loadEnv();
    registryInstance = createRegistryClient({
      baseUrl: env.REGISTRY_URL,
      internalToken: env.INTERNAL_TOKEN,
    });
  }
  return registryInstance;
}

export async function ensureRegistrantContact(userId: string): Promise<string> {
  const [user] = await db
    .select({ email: users.email, registryContactId: users.registryContactId })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) throw new Error(`user ${userId} not found`);
  if (user.registryContactId) return user.registryContactId;

  const input = contactInputForEmail(user.email);
  const { contactId } = await registry().createContact(input);
  await db
    .update(users)
    .set({ registryContactId: contactId })
    .where(eq(users.id, userId));
  return contactId;
}
