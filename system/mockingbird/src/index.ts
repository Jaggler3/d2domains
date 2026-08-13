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
    if (url.pathname !== "/v4/domains:search" && url.pathname !== "/v4/domains:checkAvailability" && url.pathname !== "/v4/domains") {
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
          "INSERT INTO domains (domain_name, available, price, reserved_at) VALUES (?, 0, ?, ?)",
        ).run(domainName, price, new Date().toISOString());
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
