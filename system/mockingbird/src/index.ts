import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { basePrice, hashState } from "./lib";

const env = {
  port: Number(Bun.env.MOCK_PORT ?? 8890),
  latencyMs: Number(Bun.env.MOCK_LATENCY_MS ?? 50),
  apiKey: Bun.env.SPACESHIP_USERNAME ?? "",
  apiSecret: Bun.env.SPACESHIP_TOKEN ?? "",
};

const DATA_DIR = "./data";
mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(`${DATA_DIR}/mockingbird.db`);
db.exec("PRAGMA journal_mode = WAL;");
db.exec(`
  CREATE TABLE IF NOT EXISTS domains (
    domain_name TEXT PRIMARY KEY,
    available INTEGER NOT NULL,
    price REAL NOT NULL DEFAULT 0,
    reserved_at TEXT
  );
  CREATE TABLE IF NOT EXISTS dns_records (
    id TEXT PRIMARY KEY,
    domain_name TEXT NOT NULL,
    type TEXT NOT NULL,
    host TEXT NOT NULL,
    answer TEXT NOT NULL,
    ttl INTEGER NOT NULL DEFAULT 3600,
    priority INTEGER
  );
`);

const SEED_TAKEN = [
  "example.com",
  "example.net",
  "example.org",
  "google.com",
  "google.net",
  "facebook.com",
  "apple.com",
  "amazon.com",
  "github.com",
  "spaceship.com",
  "microsoft.com",
  "openai.com",
];

for (const col of ["autorenew", "privacy", "locked", "nameservers"]) {
  try {
    db.exec(`ALTER TABLE domains ADD COLUMN ${col} TEXT`);
  } catch {}
}

const insert = db.prepare(
  "INSERT OR IGNORE INTO domains (domain_name, available, price) VALUES (?, 0, 0)",
);
for (const domain of SEED_TAKEN) insert.run(domain);

const findDomain = db.prepare(
  "SELECT available, price FROM domains WHERE domain_name = ?",
);

function isTaken(domain: string): boolean {
  return findDomain.get(domain) !== null;
}

interface DnsRow {
  id: string;
  domain_name: string;
  type: string;
  host: string;
  answer: string;
  ttl: number;
  priority: number | null;
}

function valueKeyForType(type: string): string {
  switch (type.toUpperCase()) {
    case "A":
    case "AAAA":
      return "address";
    case "CNAME":
    case "NS":
    case "MX":
      return "host";
    default:
      return "value";
  }
}

function rowToItem(row: DnsRow): Record<string, unknown> {
  const item: Record<string, unknown> = {
    type: row.type.toUpperCase(),
    name: row.host,
    ttl: row.ttl,
  };
  item[valueKeyForType(row.type)] = row.answer;
  if (row.priority !== null && row.priority !== undefined) {
    item.priority = row.priority;
  }
  return item;
}

function extractAnswer(item: Record<string, unknown>): string {
  const keys = [
    valueKeyForType(String(item.type ?? "")),
    ...["address", "host", "value", "data", "target", "answer"],
  ];
  for (const key of keys) {
    const v = item[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return "";
}

function normalizeItem(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null) return null;
  const item = raw as Record<string, unknown>;
  const type = String(item.type ?? "").toUpperCase();
  if (!type) return null;
  return item;
}

function valuesMatch(
  type: string,
  a: string,
  b: string,
): boolean {
  if (type.toUpperCase() === "TXT") return a === b;
  return a.toLowerCase() === b.toLowerCase();
}

const listRecords = db.prepare(
  "SELECT * FROM dns_records WHERE domain_name = ? ORDER BY type, host",
);
const insertRecord = db.prepare(
  "INSERT INTO dns_records (id, domain_name, type, host, answer, ttl, priority) VALUES (?, ?, ?, ?, ?, ?, ?)",
);
const updateRecordTtl = db.prepare(
  "UPDATE dns_records SET ttl = ?, priority = ? WHERE id = ?",
);
const deleteRecordById = db.prepare(
  "DELETE FROM dns_records WHERE id = ? AND domain_name = ?",
);

interface AvailabilityItem {
  domain: string;
  result: "available" | "unavailable";
  premiumPricing?: { operation: string; price: number; currency: string }[];
}

function availabilityFor(domainName: string): AvailabilityItem {
  const lowered = domainName.toLowerCase();
  const dot = lowered.lastIndexOf(".");
  const sld = dot > 0 ? lowered.slice(0, dot) : lowered;
  const tld = dot > 0 ? lowered.slice(dot + 1) : "";
  const registeredRow = findDomain.get(lowered) as
    | { available: number; price: number }
    | null;
  const taken =
    registeredRow !== null || hashState(sld, tld) === "taken" || tld === "";
  if (taken) return { domain: lowered, result: "unavailable" };
  if (registeredRow === null && hashState(sld, tld) === "premium") {
    return {
      domain: lowered,
      result: "available",
      premiumPricing: [
        {
          operation: "register",
          price: Math.round(basePrice(tld) * 15 * 100) / 100,
          currency: "USD",
        },
      ],
    };
  }
  return { domain: lowered, result: "available" };
}

const MOCK_CONTACT_ID = "mockcontactid000000000000000";

db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    contact_id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL
  );
`);
const findContactByEmail = db.prepare(
  "SELECT contact_id FROM contacts WHERE email = ?",
);
const insertContact = db.prepare(
  "INSERT INTO contacts (contact_id, email, first_name, last_name) VALUES (?, ?, ?, ?)",
);

function mockContactId(): string {
  return ("c" + crypto.randomUUID().replace(/-/g, "")).slice(0, 32);
}

function domainShape(row: {
  domain_name: string;
  price: number;
  reserved_at: string | null;
  autorenew: string | null;
  privacy: string | null;
  locked: string | null;
  nameservers: string | null;
}) {
  const hosts = row.nameservers
    ? (JSON.parse(row.nameservers) as string[])
    : ["ns1.spaceship.com", "ns2.spaceship.com"];
  const locked = row.locked === null ? true : row.locked === "1";
  return {
    name: row.domain_name,
    unicodeName: row.domain_name,
    isPremium: Number(row.price) > 100,
    autoRenew: row.autorenew === null ? true : row.autorenew === "1",
    registrationDate: row.reserved_at ?? new Date().toISOString(),
    expirationDate: new Date(Date.now() + 365 * 86400_000).toISOString(),
    lifecycleStatus: "registered",
    verificationStatus: "success",
    eppStatuses: locked ? ["clientTransferProhibited"] : ["ok"],
    privacyProtection: {
      contactForm: true,
      level: row.privacy === "1" ? "high" : "public",
    },
    nameservers: { provider: "custom", hosts },
    contacts: {
      registrant: MOCK_CONTACT_ID,
      admin: MOCK_CONTACT_ID,
      tech: MOCK_CONTACT_ID,
      billing: MOCK_CONTACT_ID,
    },
  };
}

const findDomainRow = db.prepare("SELECT * FROM domains WHERE domain_name = ?");

interface AsyncOperation {
  id: string;
  status: "pending" | "success" | "failed";
  type: string;
  details: Record<string, unknown>;
  createdAt: string;
  modifiedAt: string;
}

const asyncOperations = new Map<string, AsyncOperation>();

function authorized(request: Request): boolean {
  const key = request.headers.get("x-api-key") ?? "";
  const secret = request.headers.get("x-api-secret") ?? "";
  return key === env.apiKey && secret === env.apiSecret;
}

function unauthorized(): Response {
  return Response.json({ detail: "Unauthorized" }, { status: 401 });
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw Response.json({ detail: "Invalid JSON" }, { status: 400 });
  }
}

function problem(detail: string, status: number): Response {
  return Response.json({ detail }, { status });
}

function notFound(): Response {
  return Response.json({ message: "Not Found" }, { status: 404 });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const ASYNC_ROUTE_RE = /^\/v1\/async-operations\/([^/]+)$/;
const AVAILABLE_SINGLE_RE = /^\/v1\/domains\/([^/]+)\/available$/;
const DOMAIN_ROUTE_RE = /^\/v1\/domains\/([^/]+)$/;
const DNS_RECORDS_RE = /^\/v1\/dns\/records\/([^/]+)$/;
const DOMAIN_SETTING_RE = /^\/v1\/domains\/([^/]+)\/(autorenew|nameservers|privacy\/preference|privacy\/email-protection-preference|transfer\/lock)$/;

function isRegistryCall(pathname: string): boolean {
  return (
    pathname === "/v1/domains/available" ||
    pathname === "/v1/contacts" ||
    AVAILABLE_SINGLE_RE.test(pathname) ||
    DOMAIN_ROUTE_RE.test(pathname) ||
    DNS_RECORDS_RE.test(pathname) ||
    ASYNC_ROUTE_RE.test(pathname) ||
    DOMAIN_SETTING_RE.test(pathname)
  );
}

const server = Bun.serve({
  port: env.port,
  async fetch(request) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === "/healthz") {
      return Response.json({ status: "ok" });
    }
    if (!isRegistryCall(pathname)) return notFound();
    if (!authorized(request)) return unauthorized();

    if (env.latencyMs > 0) await sleep(env.latencyMs);

    try {
      if (pathname === "/v1/domains/available" && request.method === "POST") {
        const body = (await readJson(request)) as { domains?: unknown };
        if (!Array.isArray(body.domains) || body.domains.length === 0) {
          return problem("domains must be a non-empty array", 400);
        }
        if (body.domains.length > 20) {
          return problem("domains accepts at most 20 entries", 422);
        }
        const items = body.domains
          .filter((d): d is string => typeof d === "string")
          .map(availabilityFor);
        return Response.json({ domains: items });
      }

      const singleAvailable = AVAILABLE_SINGLE_RE.exec(pathname);
      if (singleAvailable && request.method === "GET") {
        return Response.json(availabilityFor(singleAvailable[1]!));
      }

      if (pathname === "/v1/contacts" && request.method === "PUT") {
        const body = (await readJson(request)) as Record<string, unknown>;
        for (const field of [
          "firstName",
          "lastName",
          "email",
          "address1",
          "city",
          "country",
          "phone",
        ]) {
          if (typeof body[field] !== "string" || (body[field] as string).length === 0) {
            return problem(`${field} is required`, 422);
          }
        }
        const country = String(body.country);
        if (!/^[A-Z]{2}$/.test(country)) {
          return problem("country must be an ISO 3166-1 alpha-2 code", 422);
        }
        const phone = String(body.phone);
        if (!/^\+\d{1,3}\.\d{4,}$/.test(phone)) {
          return problem("phone must match +<cc>.<number>", 422);
        }
        const email = String(body.email).toLowerCase();
        const existing = findContactByEmail.get(email) as
          | { contact_id: string }
          | null;
        if (existing) {
          return Response.json({ contactId: existing.contact_id });
        }
        const contactId = mockContactId();
        insertContact.run(
          contactId,
          email,
          String(body.firstName),
          String(body.lastName),
        );
        return Response.json({ contactId });
      }

      const asyncMatch = ASYNC_ROUTE_RE.exec(pathname);
      if (asyncMatch && request.method === "GET") {
        const op = asyncOperations.get(asyncMatch[1]!);
        if (!op) return problem("operation not found", 404);
        if (op.status === "pending") {
          op.status = "success";
          op.modifiedAt = new Date().toISOString();
        }
        return Response.json(op);
      }

      const domainRoute = DOMAIN_ROUTE_RE.exec(pathname);
      if (domainRoute && request.method === "POST") {
        const domainName = domainRoute[1]!.toLowerCase();
        const body = (await readJson(request)) as Record<string, unknown>;
        if (typeof body.years !== "number" || body.years < 1 || body.years > 10) {
          return problem("years must be an integer between 1 and 10", 422);
        }
        if (typeof body.autoRenew !== "boolean") {
          return problem("autoRenew is required", 422);
        }
        const privacy = body.privacyProtection as
          | { level?: unknown; userConsent?: unknown }
          | undefined;
        if (
          !privacy ||
          (privacy.level !== "high" && privacy.level !== "public") ||
          privacy.userConsent !== true
        ) {
          return problem("privacyProtection requires level and userConsent=true", 422);
        }
        const contacts = body.contacts as { registrant?: unknown } | undefined;
        if (!contacts || typeof contacts.registrant !== "string") {
          return problem("contacts.registrant is required", 422);
        }
        if (findDomain.get(domainName)) {
          return problem("domain already exists", 409);
        }
        const dot = domainName.lastIndexOf(".");
        const tld = dot > 0 ? domainName.slice(dot + 1) : "";
        const premium = hashState(
          dot > 0 ? domainName.slice(0, dot) : domainName,
          tld,
        ) === "premium";
        const price = premium ? basePrice(tld) * 15 : basePrice(tld);
        db.prepare(
          "INSERT INTO domains (domain_name, available, price, reserved_at, autorenew, privacy, locked, nameservers) VALUES (?, 0, ?, ?, ?, ?, '1', ?)",
        ).run(
          domainName,
          Math.round(price * 100) / 100,
          new Date().toISOString(),
          body.autoRenew ? "1" : "0",
          privacy.level === "high" ? "1" : "0",
          JSON.stringify(["ns1.spaceship.com", "ns2.spaceship.com"]),
        );
        insertRecord.run(crypto.randomUUID(), domainName, "A", "@", "192.0.2.1", 3600, null);
        const opId = crypto.randomUUID();
        const now = new Date().toISOString();
        asyncOperations.set(opId, {
          id: opId,
          status: "pending",
          type: "domains_Create",
          details: { domainName },
          createdAt: now,
          modifiedAt: now,
        });
        return Response.json(
          {},
          {
            status: 202,
            headers: { "spaceship-async-operationid": opId },
          },
        );
      }

      const dnsMatch = DNS_RECORDS_RE.exec(pathname);
      if (dnsMatch) {
        const domain = dnsMatch[1]!.toLowerCase();
        if (!isTaken(domain)) return problem("domain not found", 404);

        if (request.method === "GET") {
          const take = Math.min(
            Math.max(Number(url.searchParams.get("take") ?? 500), 1),
            500,
          );
          const skip = Math.max(Number(url.searchParams.get("skip") ?? 0), 0);
          const rows = listRecords.all(domain) as DnsRow[];
          const items = rows.slice(skip, skip + take).map(rowToItem);
          return Response.json({ items, total: rows.length });
        }

        if (request.method === "PUT") {
          const body = (await readJson(request)) as { items?: unknown };
          if (!Array.isArray(body.items) || body.items.length === 0) {
            return problem("items must be a non-empty array", 400);
          }
          for (const raw of body.items) {
            const item = normalizeItem(raw);
            if (!item) return problem("invalid resource record item", 422);
            const type = String(item.type).toUpperCase();
            const name = String(item.name ?? "@").toLowerCase();
            const answer = extractAnswer(item);
            if (!answer) return problem("record value is required", 422);
            const ttl = typeof item.ttl === "number" ? item.ttl : 3600;
            const priority =
              typeof item.priority === "number" ? item.priority : null;
            const existing = (listRecords.all(domain) as DnsRow[]).find(
              (r) =>
                r.type.toUpperCase() === type &&
                r.host.toLowerCase() === name &&
                valuesMatch(type, r.answer, answer),
            );
            if (existing) {
              updateRecordTtl.run(ttl, priority, existing.id);
            } else {
              insertRecord.run(crypto.randomUUID(), domain, type, name, answer, ttl, priority);
            }
          }
          return new Response(null, { status: 204 });
        }

        if (request.method === "DELETE") {
          const body = await readJson(request);
          const items = Array.isArray(body) ? body : [];
          for (const raw of items) {
            const item = normalizeItem(raw);
            if (!item) continue;
            const type = String(item.type).toUpperCase();
            const name = String(item.name ?? "@").toLowerCase();
            const answer = extractAnswer(item);
            const matches = (listRecords.all(domain) as DnsRow[]).filter(
              (r) =>
                r.type.toUpperCase() === type &&
                r.host.toLowerCase() === name &&
                (answer ? valuesMatch(type, r.answer, answer) : true),
            );
            for (const m of matches) deleteRecordById.run(m.id, domain);
          }
          return new Response(null, { status: 204 });
        }
      }

      const settingMatch = DOMAIN_SETTING_RE.exec(pathname);
      if (settingMatch && request.method === "PUT") {
        const domain = settingMatch[1]!.toLowerCase();
        const setting = settingMatch[2]!;
        const row = findDomainRow.get(domain) as Parameters<typeof domainShape>[0] | null;
        if (!row) return problem("domain not found", 404);
        const set = (col: string, val: string) => {
          db.prepare(`UPDATE domains SET ${col} = ? WHERE domain_name = ?`).run(val, domain);
        };

        if (setting === "autorenew") {
          const body = (await readJson(request)) as { isEnabled?: unknown };
          if (typeof body.isEnabled !== "boolean") {
            return problem("isEnabled is required", 422);
          }
          set("autorenew", body.isEnabled ? "1" : "0");
          return Response.json({ isEnabled: body.isEnabled });
        }
        if (setting === "nameservers") {
          const body = (await readJson(request)) as {
            provider?: unknown;
            hosts?: unknown;
          };
          if (body.provider !== "basic" && body.provider !== "custom") {
            return problem('provider must be "basic" or "custom"', 422);
          }
          const hosts = body.provider === "custom" ? body.hosts : undefined;
          if (body.provider === "custom") {
            if (
              !Array.isArray(hosts) ||
              hosts.some((h) => typeof h !== "string")
            ) {
              return problem("hosts must be an array of strings", 422);
            }
            set("nameservers", JSON.stringify(hosts));
          }
          return Response.json({
            provider: body.provider,
            hosts: hosts ?? ["ns1.spaceship.com", "ns2.spaceship.com"],
          });
        }
        if (setting === "privacy/preference") {
          const body = (await readJson(request)) as {
            privacyLevel?: unknown;
            userConsent?: unknown;
          };
          if (
            (body.privacyLevel !== "high" && body.privacyLevel !== "public") ||
            body.userConsent !== true
          ) {
            return problem("privacyLevel and userConsent=true are required", 422);
          }
          set("privacy", body.privacyLevel === "high" ? "1" : "0");
          return new Response(null, { status: 204 });
        }
        if (setting === "transfer/lock") {
          const body = (await readJson(request)) as { isLocked?: unknown };
          if (typeof body.isLocked !== "boolean") {
            return problem("isLocked is required", 422);
          }
          set("locked", body.isLocked ? "1" : "0");
          return Response.json({ isLocked: body.isLocked });
        }
      }

      if (domainRoute && request.method === "GET") {
        const domain = domainRoute[1]!.toLowerCase();
        const row = findDomainRow.get(domain) as Parameters<typeof domainShape>[0] | null;
        if (!row) return problem("domain not found", 404);
        return Response.json(domainShape(row));
      }
    } catch (err) {
      if (err instanceof Response) return err;
      console.error("[mockingbird]", err);
      return Response.json({ detail: "Internal Server Error" }, { status: 500 });
    }

    return notFound();
  },
});

console.log(`mockingbird (fake spaceship v1) listening on :${env.port}`);
console.log(`  accept key: ${env.apiKey}:${env.apiSecret.slice(0, 4)}...`);
