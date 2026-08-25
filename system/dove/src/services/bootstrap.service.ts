import type { StalwartClient } from "../adapters/stalwart";

export interface BootstrapDirectoryConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

export interface BootstrapDeps {
  stalwart: StalwartClient;
  /** Public mail hostname, e.g. mail.d2domains.dev */
  serverHostname: string;
  defaultDomain: string;
  directory: BootstrapDirectoryConfig;
}

const POLL_MS = 3000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Idempotently prepares a Stalwart server for d2domains:
 *
 * 1. If the server is in bootstrap mode (fresh install), completes the setup
 *    wizard via x:Bootstrap/set with our SQL directory wired to d2dove.
 *    Stalwart then needs ONE restart to enter normal mode — we poll until
 *    that happens (the e2e/deploy scripts own the restart).
 * 2. In normal mode, binds the SQL directory as the authentication directory
 *    (the wizard provisions the object but does not bind it).
 *
 * Safe to run on every boot; no-ops once everything is in place.
 */
export async function bootstrapStalwart(deps: BootstrapDeps): Promise<void> {
  const { stalwart } = deps;

  let inBootstrap = false;
  for (;;) {
    try {
      inBootstrap = await stalwart.isInBootstrapMode();
      break;
    } catch {
      // stalwart may still be booting — retry until reachable.
      await sleep(POLL_MS);
    }
  }

  if (inBootstrap) {
    console.log(
      `[dove] stalwart is in bootstrap mode — completing setup wizard (host=${deps.serverHostname}, domain=${deps.defaultDomain})`,
    );
    await stalwart.completeBootstrap({
      serverHostname: deps.serverHostname,
      defaultDomain: deps.defaultDomain,
      requestTlsCertificate: false,
      generateDkimKeys: true,
      directory: stalwart.sqlDirectoryPayload(deps.directory),
    });
    console.log(
      "[dove] setup submitted; waiting for stalwart to leave bootstrap mode (if this stalls, restart the stalwart container)",
    );
    let hinted = false;
    for (;;) {
      await sleep(POLL_MS);
      try {
        if (!(await stalwart.isInBootstrapMode())) break;
      } catch {
        // restart in progress — keep polling
      }
      const waited = true;
      if (waited && !hinted) {
        // one nudge after a full poll cycle of silence is enough; the outer
        // tooling (e2e up script / deploy script) performs the restart.
        hinted = true;
        console.log("[dove] still in bootstrap mode — awaiting stalwart restart…");
      }
    }
    console.log("[dove] stalwart left bootstrap mode");
  }

  const boundId = await stalwart.getAuthenticationDirectoryId();
  if (!boundId) {
    const dir =
      (await stalwart.findSqlDirectory(deps.directory.database)) ??
      (await stalwart.createSqlDirectory(stalwart.sqlDirectoryPayload(deps.directory)));
    await stalwart.setAuthenticationDirectoryId(dir.id);
    console.log(`[dove] bound authentication directory (${dir.id})`);
  }
}
