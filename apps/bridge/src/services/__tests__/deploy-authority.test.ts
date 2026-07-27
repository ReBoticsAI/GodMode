import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../tenant-registry.js", () => ({
  getTenantDb: () => {
    throw new Error("no tenant db in unit test");
  },
}));

vi.mock("../../core-db.js", () => {
  const store = new Map<string, string>();
  return {
    getCoreDb: () => ({}),
    getPlatformMeta: (_db: unknown, key: string) => store.get(key) ?? null,
    setPlatformMeta: (_db: unknown, key: string, value: string) => {
      store.set(key, value);
    },
    listAllTenantIds: () => [],
    __store: store,
  };
});

import {
  assertDeployAllowed,
  isDeployAuthorityError,
  DeployAuthorityError,
} from "../authority/deploy-authority.js";
import {
  invalidateDeployKillSwitchCache,
  setGlobalDeployKill,
  setTenantDeployKill,
} from "../authority/deploy-kill-switch.js";
import * as coreDb from "../../core-db.js";

type CoreDbMock = typeof coreDb & { __store: Map<string, string> };

function metaStore(): Map<string, string> {
  return (coreDb as CoreDbMock).__store;
}

describe("deploy authority hard-stop", () => {
  beforeEach(() => {
    metaStore().clear();
    invalidateDeployKillSwitchCache();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    invalidateDeployKillSwitchCache();
    metaStore().clear();
  });

  it("honors global deploy kill", () => {
    setGlobalDeployKill({ deployDisabled: true });
    expect(() => assertDeployAllowed({ tenantId: "t1" })).toThrow(
      DeployAuthorityError
    );
    try {
      assertDeployAllowed({ tenantId: "t1" });
    } catch (err) {
      expect(isDeployAuthorityError(err)).toBe(true);
      if (isDeployAuthorityError(err)) {
        expect(err.code).toBe("kill:global_deploy");
      }
    }
  });

  it("honors tenant deploy kill", () => {
    setTenantDeployKill("t1", { deployDisabled: true });
    expect(() => assertDeployAllowed({ tenantId: "t1" })).toThrow(/workspace/i);
    expect(() => assertDeployAllowed({ tenantId: "t2" })).not.toThrow();
  });

  it("honors PLATFORM_DEPLOY_DISABLED env nuclear", () => {
    vi.stubEnv("PLATFORM_DEPLOY_DISABLED", "true");
    try {
      assertDeployAllowed();
      expect.unreachable("expected throw");
    } catch (err) {
      expect(isDeployAuthorityError(err)).toBe(true);
      if (isDeployAuthorityError(err)) {
        expect(err.code).toBe("kill:env_deploy");
      }
    }
  });
});
