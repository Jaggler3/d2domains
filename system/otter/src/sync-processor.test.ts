import { describe, expect, test } from "bun:test";
import {
  createSyncProcessor,
  type RegistryDnsRecord,
  type SyncDeps,
  type SyncRecord,
} from "./sync-processor";

function registryError(status: number) {
  const err = new Error(`registry responded ${status}`);
  (err as { status?: number }).status = status;
  return err;
}

function buildDeps(overrides: Partial<SyncDeps> = {}) {
  const state: {
    record: SyncRecord;
    syncedTo: string | null;
    errorMessage: string | null;
    deleted: string | null;
  } = {
    record: {
      id: "r1",
      type: "A",
      name: "www",
      value: "192.0.2.10",
      ttl: 300,
      priority: null,
      registryRecordId: null,
    },
    syncedTo: null,
    errorMessage: null,
    deleted: null,
  };

  const deps: SyncDeps = {
    getRecord: async (recordId) =>
      recordId === state.record.id
        ? { record: state.record, zone: { domainName: "test.com" } }
        : null,
    setSynced: async (recordId, registryRecordId) => {
      state.syncedTo = registryRecordId;
    },
    markError: async (_recordId, message) => {
      state.errorMessage = message;
    },
    deleteRecordLocal: async (recordId) => {
      state.deleted = recordId;
    },
    registry: {
      listDnsRecords: async () => ({ records: [] }),
      createDnsRecord: async () => {
        throw new Error("unexpected create");
      },
      updateDnsRecord: async () => {
        throw new Error("unexpected update");
      },
      deleteDnsRecord: async () => undefined,
    },
    ...overrides,
  };

  return { deps, state };
}

describe("dns-sync processor", () => {
  test("create: syncs and stores the registry record id", async () => {
    const registry: SyncDeps["registry"] = {
      listDnsRecords: async () => ({ records: [] }),
      createDnsRecord: async () => ({ record: { id: 13344078, type: "A", answer: "1.2.3.4", ttl: 300, priority: null } }),
      updateDnsRecord: async () => {
        throw new Error("should not update");
      },
      deleteDnsRecord: async () => undefined,
    };
    const { deps, state } = buildDeps({ registry });
    const process = createSyncProcessor(deps);

    await process({ recordId: "r1", op: "create" });

    expect(state.syncedTo).toBe("13344078");
    expect(state.errorMessage).toBeNull();
  });

  test("update: uses the existing registry id", async () => {
    const { deps, state } = buildDeps({
      registry: {
        listDnsRecords: async () => ({ records: [] }),
        createDnsRecord: async () => {
          throw new Error("should not create");
        },
        updateDnsRecord: async () => ({ record: { id: "abc", type: "A", answer: "1.2.3.4", ttl: 300, priority: null } }),
        deleteDnsRecord: async () => undefined,
      },
    });
    state.record.registryRecordId = "abc";
    const process = createSyncProcessor(deps);

    await process({ recordId: "r1", op: "update" });

    expect(state.syncedTo).toBe("abc");
  });

  test("create duplicate: adopts the existing registry record (reconcile)", async () => {
    const remote: RegistryDnsRecord[] = [
      { id: "999", type: "A", host: "www", answer: "1.1.1.1", ttl: 300, priority: null },
    ];
    const { deps, state } = buildDeps({
      registry: {
        listDnsRecords: async () => ({ records: remote }),
        createDnsRecord: async () => {
          throw registryError(400);
        },
        updateDnsRecord: async () => {
          throw new Error("should not update");
        },
        deleteDnsRecord: async () => undefined,
      },
    });
    const process = createSyncProcessor(deps);

    await process({ recordId: "r1", op: "create" });

    expect(state.syncedTo).toBe("999");
    expect(state.errorMessage).toBeNull();
  });

  test("create duplicate at root (@): reconciles using missing-host default", async () => {
    const remote: RegistryDnsRecord[] = [
      { id: "root-txt", type: "TXT", answer: "v=spf1 -all", ttl: 3600, priority: null },
    ];
    const { deps, state } = buildDeps({
      registry: {
        listDnsRecords: async () => ({ records: remote }),
        createDnsRecord: async () => {
          throw registryError(400);
        },
        updateDnsRecord: async () => {
          throw new Error("should not update");
        },
        deleteDnsRecord: async () => undefined,
      },
    });
    state.record = { ...state.record, type: "TXT", name: "@" };
    const process = createSyncProcessor(deps);

    await process({ recordId: "r1", op: "create" });

    expect(state.syncedTo).toBe("root-txt");
  });

  test("terminal create error with no match marks the record failed", async () => {
    const { deps, state } = buildDeps({
      registry: {
        listDnsRecords: async () => ({ records: [] }),
        createDnsRecord: async () => {
          throw registryError(400);
        },
        updateDnsRecord: async () => {
          throw new Error("should not update");
        },
        deleteDnsRecord: async () => undefined,
      },
    });
    const process = createSyncProcessor(deps);

    await process({ recordId: "r1", op: "create" });

    expect(state.errorMessage).toContain("registry responded 400");
    expect(state.syncedTo).toBeNull();
  });

  test("transient error (500) rethrows for retry", async () => {
    const { deps } = buildDeps({
      registry: {
        listDnsRecords: async () => ({ records: [] }),
        createDnsRecord: async () => {
          throw registryError(500);
        },
        updateDnsRecord: async () => {
          throw new Error("should not update");
        },
        deleteDnsRecord: async () => undefined,
      },
    });
    const process = createSyncProcessor(deps);

    await expect(process({ recordId: "r1", op: "create" })).rejects.toThrow(
      "registry responded 500",
    );
  });

  test("delete: removes from registry then locally", async () => {
    let deletedRemote = false;
    let deletedLocal: string | null = null;
    const { deps, state } = buildDeps({
      deleteRecordLocal: async (recordId) => {
        deletedLocal = recordId;
      },
      registry: {
        listDnsRecords: async () => ({ records: [] }),
        createDnsRecord: async () => {
          throw new Error("should not create");
        },
        updateDnsRecord: async () => {
          throw new Error("should not update");
        },
        deleteDnsRecord: async () => {
          deletedRemote = true;
          return undefined;
        },
      },
    });
    state.record.registryRecordId = "abc";
    const process = createSyncProcessor(deps);

    await process({ recordId: "r1", op: "delete" });

    expect(deletedRemote).toBe(true);
    expect(deletedLocal === "r1").toBe(true);
  });

  test("delete: skips registry when never synced", async () => {
    let deletedRemote = false;
    const { deps } = buildDeps({
      registry: {
        listDnsRecords: async () => ({ records: [] }),
        createDnsRecord: async () => {
          throw new Error("should not create");
        },
        updateDnsRecord: async () => {
          throw new Error("should not update");
        },
        deleteDnsRecord: async () => {
          deletedRemote = true;
          return undefined;
        },
      },
    });
    const process = createSyncProcessor(deps);

    await process({ recordId: "r1", op: "delete" });

    expect(deletedRemote).toBe(false);
  });

  test("missing record is a no-op", async () => {
    const { deps, state } = buildDeps();
    const process = createSyncProcessor(deps);

    await expect(process({ recordId: "nope", op: "create" })).resolves.toBeUndefined();
    expect(state.syncedTo).toBeNull();
  });
});
