import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../tenant-registry.js", () => ({
  getTenantDb: () => {
    throw new Error("no tenant db in unit test");
  },
}));

vi.mock("../../core-db.js", () => {
  const store = new Map<string, string>();
  return {
    getCloudDb: () => ({}),
    getPlatformMeta: (_db: unknown, key: string) => store.get(key) ?? null,
    setPlatformMeta: (_db: unknown, key: string, value: string) => {
      store.set(key, value);
    },
    listAllTenantIds: () => [],
    __store: store,
  };
});

import {
  assertDeleteAllowed,
  isDeleteAuthorityError,
  DeleteAuthorityError,
} from "../authority/delete-authority.js";
import {
  invalidateDeleteKillSwitchCache,
  setGlobalDeleteKill,
  setTenantDeleteKill,
} from "../authority/delete-kill-switch.js";
import * as coreDb from "../../core-db.js";

type CoreDbMock = typeof coreDb & { __store: Map<string, string> };

function metaStore(): Map<string, string> {
  return (coreDb as CoreDbMock).__store;
}

describe("delete authority hard-stop", () => {
  beforeEach(() => {
    metaStore().clear();
    invalidateDeleteKillSwitchCache();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    invalidateDeleteKillSwitchCache();
    metaStore().clear();
  });

  it("honors global delete kill", () => {
    setGlobalDeleteKill({ deleteDisabled: true });
    expect(() => assertDeleteAllowed({ tenantId: "t1" })).toThrow(
      DeleteAuthorityError
    );
    try {
      assertDeleteAllowed({ tenantId: "t1" });
    } catch (err) {
      expect(isDeleteAuthorityError(err)).toBe(true);
      if (isDeleteAuthorityError(err)) {
        expect(err.code).toBe("kill:global_delete");
      }
    }
  });

  it("honors tenant delete kill", () => {
    setTenantDeleteKill("t1", { deleteDisabled: true });
    expect(() => assertDeleteAllowed({ tenantId: "t1" })).toThrow(/workspace/i);
    expect(() => assertDeleteAllowed({ tenantId: "t2" })).not.toThrow();
  });

  it("honors PLATFORM_DELETE_DISABLED env nuclear", () => {
    vi.stubEnv("PLATFORM_DELETE_DISABLED", "true");
    try {
      assertDeleteAllowed();
      expect.unreachable("expected throw");
    } catch (err) {
      expect(isDeleteAuthorityError(err)).toBe(true);
      if (isDeleteAuthorityError(err)) {
        expect(err.code).toBe("kill:env_delete");
      }
    }
  });
});
