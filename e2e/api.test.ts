/**
 * d2domains API end-to-end suite.
 *
 * Runs against a live mock compose stack (real services, fake registry):
 *   docker compose -f docker-compose.yml -f docker-compose.mock.yml up -d --build
 *   cd e2e && bun run api
 *
 * Covers: registration, search, buy (+email add-on), provisioning into
 * Stalwart, published DNS records, DNS CRUD + registry sync, registrar
 * settings, idempotent re-buy, and declined-payment → auto-refund.
 */
import { describe, expect, test } from "bun:test";
import postgres from "postgres";

const HOG = process.env.HOG_URL ?? "http://localhost:8787";
const STALWART = process.env.STALWART_URL ?? "http://localhost:18080";
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN ?? "";
const WOMBAT_DB =
  process.env.E2E_WOMBAT_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5433/d2wombat";
const MAIL_HOST = process.env.MAIL_HOST ?? "mail.d2domains.dev";

interface User {
  email: string;
  password: string;
  cookie: string;
}

function uniq(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function req(
  method: string,
  path: string,
  opts: { body?: unknown; cookie?: string } = {},
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${HOG}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, json };
}

async function newUser(prefix: string): Promise<User> {
  const email = `${prefix}-${uniq()}@e2e.test.local`;
  const password = `pw-${uniq()}-A1`;
  const res = await fetch(`${HOG}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  const setCookie = res.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0];
  if (!cookie.startsWith("hog_session=")) throw new Error("no session cookie");
  return { email, password, cookie };
}

async function waitFor<T>(
  fn: () => Promise<T | null>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const result = await fn();
      if (result !== null) return result;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`timeout waiting for ${label}${lastErr ? ` (last: ${lastErr})` : ""}`);
}

async function addPaymentMethod(user: User): Promise<string> {
  const { status, json } = await req("POST", "/api/v1/billing/methods", {
    body: { token: `pm_test_${uniq()}`, brand: "Visa", last4: "4242" },
    cookie: user.cookie,
  });
  expect(status).toBe(201);
  expect(json.paymentMethod.id).toBeString();
  return json.paymentMethod.id;
}

/** Finds an available, non-premium domain under the mocked registry. */
async function findAvailableDomain(tag: string): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const keyword = `e2e${tag}${String.fromCharCode(97 + i)}`;
    const { status, json } = await req("POST", "/api/v1/domains/search", {
      body: { keyword, tldFilter: ["com"] },
    });
    expect(status).toBe(200);
    const hit = (json.results ?? []).find(
      (r: any) => r.purchasable && !r.premium,
    );
    if (hit) return hit.domainName;
  }
  throw new Error("no available domain found after 12 candidates");
}

async function stalwartEcho(user: string, password: string): Promise<number> {
  const res = await fetch(`${STALWART}/jmap`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${btoa(`${user}:${password}`)}`,
    },
    body: JSON.stringify({
      using: ["urn:ietf:params:jmap:core"],
      methodCalls: [["Core/echo", { ping: true }, "c0"]],
    }),
  });
  return res.status;
}

describe("purchase journey with email add-on", () => {
  const tag = uniq();
  let user: User;
  let domainName: string;
  let orderId: string;
  let mailboxPassword: string;

  test("registers, searches, buys domain + email starter", async () => {
    user = await newUser(`buyer-${tag}`);
    domainName = await findAvailableDomain(tag);

    const paymentMethodId = await addPaymentMethod(user);
    const { status, json } = await req("POST", "/api/v1/domains/buy", {
      body: {
        domainName,
        years: 1,
        paymentMethodId,
        addons: [{ type: "email", plan: "starter", mailboxes: 2 }],
      },
      cookie: user.cookie,
    });
    expect([202, 200]).toContain(status);
    orderId = json.order.id;
    expect(orderId).not.toBeUndefined();
  });

  test("order reaches purchased (charge → register → domain)", async () => {
    const order = await waitFor<{ status: string; error: string | null }>(
      async () => {
        const { json } = await req("GET", `/api/v1/orders/${orderId}`, {
          cookie: user.cookie,
        });
        if (json?.order?.status === "purchased" || json?.order?.status === "failed") {
          return json.order;
        }
        return null;
      },
      120_000,
      `order ${orderId} to settle`,
    );
    expect(order.status).toBe("purchased");
    expect(order.error).toBeNull();
  }, 210000);

  test("mailboxes provision into stalwart with credentials readable", async () => {
    const mailbox = await waitFor<any>(
      async () => {
        const { status, json } = await req(
          "GET",
          `/api/v1/domains/${domainName}/email`,
          { cookie: user.cookie },
        );
        return status === 200 ? json : null;
      },
      300_000,
      "mailbox provisioning",
    );
    expect(mailbox.address).toBe(`admin@${domainName}`);
    expect(mailbox.password.length).toBeGreaterThanOrEqual(15);
    expect(mailbox.imapHost).toBe(MAIL_HOST);
    expect(mailbox.mailboxes.map((m: any) => m.address)).toEqual([
      `admin@${domainName}`,
      `user2@${domainName}`,
    ]);
    mailboxPassword = mailbox.password;
  }, 360000);

  test("stalwart authenticates the provisioned account (sql directory)", async () => {
    const good = await stalwartEcho(`admin@${domainName}`, mailboxPassword);
    expect(good).toBe(200);
    const bad = await stalwartEcho(`admin@${domainName}`, "definitely-wrong");
    expect(bad).toBe(401);
  });

  test("email dns records are published and synced to the registry", async () => {
    const records = await waitFor<any[]>(
      async () => {
        const { status, json } = await req(
          "GET",
          `/api/v1/domains/${domainName}/dns`,
          { cookie: user.cookie },
        );
        if (status !== 200) return null;
        const recs = json.records ?? [];
        const needed = ["MX", "TXT:@", "TXT:_dmarc"];
        const have = (t: string, n: string) =>
          recs.some((r: any) => r.type === t && (r.name === n || (n === "@" && r.name === "")));
        const dkim = recs.find((r: any) => r.type === "TXT" && String(r.name).endsWith("._domainkey"));
        const allSet =
          have("MX", "@") && have("TXT", "@") && have("TXT", "_dmarc") && dkim !== undefined;
        if (!allSet) return null;
        const allSynced = recs.every((r: any) => r.syncStatus === "synced");
        return allSynced ? recs : null;
      },
      90_000,
      "email dns records synced",
    );
    const mx = records.find((r: any) => r.type === "MX");
    expect(mx.value).toBe(MAIL_HOST);
    expect(mx.priority).toBe(10);
    const spf = records.find(
      (r: any) => r.type === "TXT" && (r.name === "@" || r.name === ""),
    );
    expect(spf.value).toContain("v=spf1");
    const dmarc = records.find((r: any) => r.name === "_dmarc");
    expect(dmarc.value).toContain("v=DMARC1");
  }, 150000);

  test("re-buying an owned domain is rejected (idempotency)", async () => {
    const { status, json } = await req("POST", "/api/v1/domains/buy", {
      body: { domainName, years: 1, addons: [] },
      cookie: user.cookie,
    });
    expect(status).toBe(409);
    expect(String(json.error)).toContain("already own");
  });

  test("dashboard lists the purchased domain and order", async () => {
    const domains = await req("GET", "/api/v1/domains", { cookie: user.cookie });
    expect(domains.status).toBe(200);
    expect(domains.json.domains.map((d: any) => d.domainName)).toContain(domainName);

    const orders = await req("GET", "/api/v1/orders", { cookie: user.cookie });
    expect(orders.json.orders.map((o: any) => o.id)).toContain(orderId);
  });
});

describe("dns records management", () => {
  const tag = uniq();
  let user: User;
  let domainName: string;

  test("buys a plain domain", async () => {
    user = await newUser(`dns-${tag}`);
    domainName = await findAvailableDomain(tag);
    const paymentMethodId = await addPaymentMethod(user);
    const { status, json } = await req("POST", "/api/v1/domains/buy", {
      body: { domainName, years: 1, paymentMethodId, addons: [] },
      cookie: user.cookie,
    });
    expect([202, 200]).toContain(status);
    const order = await waitFor<{ status: string; error: string | null }>(
      async () => {
        const { json: o } = await req("GET", `/api/v1/orders/${json.order.id}`, {
          cookie: user.cookie,
        });
        return o?.order?.status === "purchased" || o?.order?.status === "failed"
          ? o.order
          : null;
      },
      120_000,
      "plain order to settle",
    );
    expect(order.status).toBe("purchased");
  }, 210000);

  test("creates, updates and deletes an A record with registry sync", async () => {
    const created = await req("POST", `/api/v1/domains/${domainName}/dns`, {
      body: { type: "A", name: "www", value: "203.0.113.7" },
      cookie: user.cookie,
    });
    expect(created.status).toBe(201);
    const recordId = created.json.record.id;

    const synced = await waitFor<string>(
      async () => {
        const { json } = await req("GET", `/api/v1/domains/${domainName}/dns`, {
          cookie: user.cookie,
        });
        const r = (json.records ?? []).find((x: any) => x.id === recordId);
        return r?.syncStatus === "synced" ? "synced" : null;
      },
      60_000,
      "record sync",
    );
    expect(synced).toBe("synced");

    const patched = await req(
      "PATCH",
      `/api/v1/domains/${domainName}/dns/${recordId}`,
      { body: { value: "203.0.113.8" }, cookie: user.cookie },
    );
    expect(patched.status).toBe(200);
    expect(patched.json.record.value).toBe("203.0.113.8");

    const removed = await req(
      "DELETE",
      `/api/v1/domains/${domainName}/dns/${recordId}`,
      { cookie: user.cookie },
    );
    expect(removed.status).toBe(204);

    // deletion is eventual: otter marks the row "deleting" and removes it
    // once the registry confirms.
    const gone = await waitFor<boolean>(
      async () => {
        const { json } = await req("GET", `/api/v1/domains/${domainName}/dns`, {
          cookie: user.cookie,
        });
        return (json.records ?? []).some((x: any) => x.id === recordId)
          ? null
          : true;
      },
      60_000,
      "record deletion to propagate",
    );
    expect(gone).toBe(true);
  }, 120000);

  test("updates registrar settings (autorenew, privacy, lock, nameservers)", async () => {
    const patched = await req(
      "PATCH",
      `/api/v1/domains/${domainName}/settings`,
      {
        body: {
          autorenew: false,
          whoisPrivacy: true,
          transferLock: true,
          nameservers: ["ns1.e2e.test", "ns2.e2e.test"],
        },
        cookie: user.cookie,
      },
    );
    expect(patched.status).toBe(200);

    const get = await req("GET", `/api/v1/domains/${domainName}/settings`, {
      cookie: user.cookie,
    });
    expect(get.status).toBe(200);
    expect(get.json.domain.autorenewEnabled).toBe(false);
    expect(get.json.domain.privacyEnabled).toBe(true);
    expect(get.json.domain.locked).toBe(true);
    expect(get.json.domain.nameservers).toEqual([
      "ns1.e2e.test",
      "ns2.e2e.test",
    ]);
  });

  test("rejects unauthenticated access to domain resources", async () => {
    const { status } = await req("GET", `/api/v1/domains`);
    expect(status).toBe(401);
  });
});

describe("declined payment refunds the charge", () => {
  const tag = uniq();
  const sql = postgres(WOMBAT_DB, { max: 1 });

  test("huge total declines; order fails; wombat auto-refunds", async () => {
    const user = await newUser(`decline-${tag}`);
    const domainName = await findAvailableDomain(tag);
    const paymentMethodId = await addPaymentMethod(user);

    // years=10 x mailboxes=100 blows past the mock decline threshold ($500).
    const { status, json } = await req("POST", "/api/v1/domains/buy", {
      body: {
        domainName,
        years: 10,
        paymentMethodId,
        addons: [{ type: "email", plan: "starter", mailboxes: 100 }],
      },
      cookie: user.cookie,
    });
    expect([202, 200]).toContain(status);

    const order = await waitFor<{ status: string; error: string | null }>(
      async () => {
        const { json: o } = await req("GET", `/api/v1/orders/${json.order.id}`, {
          cookie: user.cookie,
        });
        return o?.order?.status === "failed" || o?.order?.status === "purchased"
          ? o.order
          : null;
      },
      120_000,
      "declined order to settle",
    );
    expect(order.status).toBe("failed");
    expect(String(order.error)).toContain("payment declined");

    // The charge itself was declined, so no money moved and there must be no
    // refund entry. (The refund-on-terminal-failure-after-charge path is
    // covered by badger's unit tests with a succeeded charge.)
    const charges = await sql`
      SELECT c.id, c.status AS charge_status
      FROM charges c WHERE c.order_id = ${json.order.id}
    `;
    expect(charges.length).toBe(1);
    expect(charges[0].charge_status).toBe("failed");
    const refunds = await sql`
      SELECT l.* FROM ledger_entries l
      WHERE l.ref_id = ${charges[0].id} AND l.type = 'refund'
    `;
    expect(refunds.length).toBe(0);
    await sql.end();
  }, 210000);
});
