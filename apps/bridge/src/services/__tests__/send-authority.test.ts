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
  assertSendAllowed,
  isSendAuthorityError,
  SendAuthorityError,
} from "../authority/send-authority.js";
import {
  invalidateSendKillSwitchCache,
  setGlobalSendKill,
  setTenantSendKill,
} from "../authority/send-kill-switch.js";
import * as coreDb from "../../core-db.js";

type CoreDbMock = typeof coreDb & { __store: Map<string, string> };

function metaStore(): Map<string, string> {
  return (coreDb as CoreDbMock).__store;
}

describe("send authority hard-stop", () => {
  beforeEach(() => {
    metaStore().clear();
    invalidateSendKillSwitchCache();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    invalidateSendKillSwitchCache();
    metaStore().clear();
  });

  it("honors global send kill", () => {
    setGlobalSendKill({ sendDisabled: true });
    expect(() => assertSendAllowed({ tenantId: "t1" })).toThrow(
      SendAuthorityError
    );
    try {
      assertSendAllowed({ tenantId: "t1" });
    } catch (err) {
      expect(isSendAuthorityError(err)).toBe(true);
      if (isSendAuthorityError(err)) {
        expect(err.code).toBe("kill:global_send");
      }
    }
  });

  it("honors tenant send kill", () => {
    setTenantSendKill("t1", { sendDisabled: true });
    expect(() => assertSendAllowed({ tenantId: "t1" })).toThrow(/workspace/i);
    expect(() => assertSendAllowed({ tenantId: "t2" })).not.toThrow();
  });

  it("honors PLATFORM_SEND_DISABLED env nuclear", () => {
    vi.stubEnv("PLATFORM_SEND_DISABLED", "true");
    try {
      assertSendAllowed();
      expect.unreachable("expected throw");
    } catch (err) {
      expect(isSendAuthorityError(err)).toBe(true);
      if (isSendAuthorityError(err)) {
        expect(err.code).toBe("kill:env_send");
      }
    }
  });
});
