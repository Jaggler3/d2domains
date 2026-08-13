import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import {
  checkCandidates,
  DEFAULT_TLDS,
  hashState,
  searchCandidates,
} from "./lib";

const env = {
  port: Number(Bun.env.MOCK_PORT ?? 8890),
  latencyMs: Number(Bun.env.MOCK_LATENCY_MS ?? 50),
  username: Bun.env.NAME_COM_USERNAME ?? "",
  token: Bun.env.NAME_COM_TOKEN ?? "",
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
  "name.com",
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

function recordShape(row: {
  id: string;
  domain_name: string;
  type: string;
  host: string;
  answer: string;
  ttl: number;
  priority: number | null;
}) {
  // name.com omits `host` for root (@) records, keeping only fqdn
  const base = {
    id: row.id,
    type: row.type,
    fqdn: row.host === "@" ? row.domain_name : `${row.host}.${row.domain_name}`,
    answer: row.answer,
    ttl: row.ttl,
    priority: row.priority,
  };
  return row.host === "@" ? base : { ...base, host: row.host };
}

const listRecords = db.prepare(
  "SELECT * FROM dns_records WHERE domain_name = ? ORDER BY type, host",
);
const findRecord = db.prepare(
  "SELECT * FROM dns_records WHERE id = ? AND domain_name = ?",
);
const insertRecord = db.prepare(
  "INSERT INTO dns_records (id, domain_name, type, host, answer, ttl, priority) VALUES (?, ?, ?, ?, ?, ?, ?)",
);
const updateRecord = db.prepare(
  "UPDATE dns_records SET type = ?, host = ?, answer = ?, ttl = ?, priority = ? WHERE id = ? AND domain_name = ?",
);
const deleteRecord = db.prepare(
  "DELETE FROM dns_records WHERE id = ? AND domain_name = ?",
);

const DOMAIN_RECORDS_RE = /^\/v4\/domains\/([^/]+)\/records(?:\/([^/]+))?$/;
const DOMAIN_ACTION_RE = /^\/v4\/domains\/([^/]+):(\w+)$/;

function domainShape(row: {
  domain_name: string;
  price: number;
  reserved_at: string | null;
  autorenew: string | null;
  privacy: string | null;
  locked: string | null;
  nameservers: string | null;
}) {
  const price = Number(row.price);
  return {
    domainName: row.domain_name,
    nameservers: row.nameservers
      ? (JSON.parse(row.nameservers) as string[])
      : ["ns1.name.com", "ns2.name.com"],
    privacyEnabled: row.privacy === "1",
    locked: row.locked === null ? true : row.locked === "1",
    autorenewEnabled: row.autorenew === null ? true : row.autorenew === "1",
    expireDate: new Date(Date.now() + 365 * 86400_000).toISOString(),
    createDate: row.reserved_at ?? new Date().toISOString(),
    renewalPrice: price,
  };
}

const findDomainRow = db.prepare(
  "SELECT * FROM domains WHERE domain_name = ?",
);

function authorized(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  const expected = `Basic ${Buffer.from(`${env.username}:${env.token}`).toString("base64")}`;
  return header === expected;
}

function unauthorized(): Response {
  return Response.json({ message: "Unauthorized" }, { status: 401 });
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Response(JSON.stringify({ message: "Invalid JSON" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const server = Bun.serve({
  port: env.port,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/healthz") {
      return Response.json({ status: "ok" });
    }
    const isRegistryCall =
      url.pathname === "/v4/domains:search" ||
      url.pathname === "/v4/domains:checkAvailability" ||
      url.pathname === "/v4/domains" ||
      DOMAIN_RECORDS_RE.test(url.pathname) ||
      DOMAIN_ACTION_RE.test(url.pathname) ||
      /^\/v4\/domains\/[^/]+$/.test(url.pathname);
    if (!isRegistryCall) {
      return Response.json({ message: "Not Found" }, { status: 404 });
    }
    if (!authorized(request)) return unauthorized();

    if (env.latencyMs > 0) await sleep(env.latencyMs);

    try {
      if (url.pathname === "/v4/domains:search") {
        const body = await readJson(request);
        const keyword = String(body.keyword ?? "").trim().toLowerCase();
        if (!keyword) {
          return Response.json({ message: "keyword is required" }, { status: 400 });
        }
        const tldFilter = Array.isArray(body.tldFilter)
          ? (body.tldFilter as string[]).map((t) => t.replace(/^\./, "").toLowerCase())
          : [];
        const tlds = tldFilter.length > 0 ? tldFilter : [...DEFAULT_TLDS];
        const results = searchCandidates(keyword, tlds, isTaken);
        return Response.json({ results });
      }

      if (url.pathname === "/v4/domains:checkAvailability") {
        const body = await readJson(request);
        const domainNames = Array.isArray(body.domainNames)
          ? (body.domainNames as string[]).slice(0, 50)
          : [];
        const results = checkCandidates(domainNames, isTaken);
        return Response.json({ results });
      }

      if (url.pathname === "/v4/domains" && request.method === "POST") {
        const body = await readJson(request);
        const domainName = String((body.domain as { domainName?: string } | undefined)?.domainName ?? "")
          .toLowerCase();
        if (!domainName) {
          return Response.json({ message: "domain is required" }, { status: 400 });
        }
        const existing = findDomain.get(domainName);
        if (existing) {
          return Response.json({ message: "domain already taken" }, { status: 409 });
        }
        const dot = domainName.lastIndexOf(".");
        const sld = dot > 0 ? domainName.slice(0, dot) : domainName;
        const tld = dot > 0 ? domainName.slice(dot + 1) : "";
        const price = Number(body.purchasePrice ?? (hashState(sld, tld) === "premium" ? 100 : 12.99));
        db.prepare(
          "INSERT INTO domains (domain_name, available, price, reserved_at, autorenew, privacy, locked, nameservers) VALUES (?, 0, ?, ?, '1', '0', '1', ?)",
        ).run(domainName, price, new Date().toISOString(), JSON.stringify(["ns1.name.com", "ns2.name.com"]));
        insertRecord.run(
          crypto.randomUUID(),
          domainName,
          "A",
          "@",
          "192.0.2.1",
          3600,
          null,
        );
        return Response.json(
          {
            domain: {
              domainName,
              locked: true,
              autorenewEnabled: true,
              expireDate: new Date(Date.now() + 365 * 86400_000).toISOString(),
              createDate: new Date().toISOString(),
              renewalPrice: price,
            },
            order: Math.floor(Math.random() * 1_000_000),
            totalPaid: price,
          },
          { status: 201 },
        );
      }

      const dnsMatch = DOMAIN_RECORDS_RE.exec(url.pathname);
      if (dnsMatch) {
        const domain = dnsMatch[1]!.toLowerCase();
        const recordId = dnsMatch[2];
        if (!isTaken(domain)) {
          return Response.json({ message: "domain not found" }, { status: 404 });
        }

        if (url.pathname === `/v4/domains/${domain}/records` && request.method === "GET") {
          const rows = listRecords.all(domain) as {
            id: string; domain_name: string; type: string; host: string; answer: string; ttl: number; priority: number | null;
          }[];
          const records = rows.map(recordShape);
          // name.com returns bare {} when a domain has no records, not {records: []}
          return Response.json(records.length === 0 ? {} : { records });
        }

        if (url.pathname === `/v4/domains/${domain}/records` && request.method === "POST") {
          const body = await readJson(request);
          const type = String(body.type ?? "").toUpperCase();
          const host = String(body.host ?? "@").toLowerCase();
          const answer = String(body.answer ?? "");
          const ttl = Number(body.ttl ?? 3600);
          const priority = body.priority === undefined || body.priority === null ? null : Number(body.priority);
          if (!type || !answer) {
            return Response.json({ message: "type and answer are required" }, { status: 400 });
          }
          const id = crypto.randomUUID();
          insertRecord.run(id, domain, type, host, answer, ttl, priority);
          const row = findRecord.get(id, domain) as {
            id: string; domain_name: string; type: string; host: string; answer: string; ttl: number; priority: number | null;
          };
          return Response.json({ record: recordShape(row) }, { status: 201 });
        }

        if (recordId && url.pathname === `/v4/domains/${domain}/records/${recordId}`) {
          const existing = findRecord.get(recordId, domain) as {
            id: string; domain_name: string; type: string; host: string; answer: string; ttl: number; priority: number | null;
          } | null;
          if (!existing) {
            return Response.json({ message: "record not found" }, { status: 404 });
          }

          if (request.method === "PUT") {
            const body = await readJson(request);
            const type = String(body.type ?? existing.type).toUpperCase();
            const host = String(body.host ?? existing.host).toLowerCase();
            const answer = String(body.answer ?? existing.answer);
            const ttl = body.ttl === undefined ? Number(existing.ttl) : Number(body.ttl);
            const priority = body.priority === undefined || body.priority === null ? (existing.priority ?? null) : Number(body.priority);
            updateRecord.run(type, host, answer, ttl, priority, recordId, domain);
            const row = findRecord.get(recordId, domain) as {
              id: string; domain_name: string; type: string; host: string; answer: string; ttl: number; priority: number | null;
            };
            return Response.json({ record: recordShape(row) });
          }

          if (request.method === "DELETE") {
            deleteRecord.run(recordId, domain);
            return new Response(null, { status: 204 });
          }
        }
      }

      const actionMatch = DOMAIN_ACTION_RE.exec(url.pathname);
      if (actionMatch) {
        const domain = actionMatch[1]!.toLowerCase();
        const action = actionMatch[2]!;
        if (!isTaken(domain)) {
          return Response.json({ message: "domain not found" }, { status: 404 });
        }
        const row = findDomainRow.get(domain) as {
          domain_name: string; price: number; reserved_at: string | null;
          autorenew: string | null; privacy: string | null; locked: string | null; nameservers: string | null;
        };

        if (action === "getPricing") {
          const price = Number(row.price);
          return Response.json({
            purchasePrice: price,
            renewalPrice: price,
            transferPrice: price,
            premium: price > 100,
          });
        }

        const set = (col: string, val: string) => {
          db.prepare(`UPDATE domains SET ${col} = ? WHERE domain_name = ?`).run(val, domain);
        };
        const respond = () => Response.json({ domain: domainShape(row) });

        switch (action) {
          case "enableAutorenew":
            set("autorenew", "1");
            return respond();
          case "disableAutorenew":
            set("autorenew", "0");
            return respond();
          case "enableWhoisPrivacy":
            set("privacy", "1");
            return respond();
          case "disableWhoisPrivacy":
            set("privacy", "0");
            return respond();
          case "lockDomain":
            set("locked", "1");
            return respond();
          case "unlockDomain":
            set("locked", "0");
            return respond();
          case "setNameservers": {
            const body = await readJson(request);
            const nameservers = Array.isArray(body.nameservers)
              ? (body.nameservers as string[])
              : [];
            if (nameservers.length === 0) {
              return Response.json({ message: "nameservers are required" }, { status: 400 });
            }
            set("nameservers", JSON.stringify(nameservers));
            return respond();
          }
          default:
            return Response.json({ message: "Not Found" }, { status: 404 });
        }
      }

      const domainInfo = /^\/v4\/domains\/([^/]+)$/.exec(url.pathname);
      if (domainInfo && request.method === "GET") {
        const domain = domainInfo[1]!.toLowerCase();
        const row = findDomainRow.get(domain);
        if (!row) return Response.json({ message: "domain not found" }, { status: 404 });
        return Response.json(domainShape(row as Parameters<typeof domainShape>[0]));
      }
    } catch (err) {
      if (err instanceof Response) return err;
      console.error("[mockingbird]", err);
      return Response.json({ message: "Internal Server Error" }, { status: 500 });
    }

    return Response.json({ message: "Not Found" }, { status: 404 });
  },
});

console.log(`mockingbird (fake name.com) listening on :${env.port}`);
console.log(`  accept auth: ${env.username}:${env.token.slice(0, 4)}...`);
