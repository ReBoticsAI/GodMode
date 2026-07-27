import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../coding/coding-ui-access.js", () => ({
  codingUiAllowed: () => true,
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
  acquireTerminalSlot,
  assertCodingQuota,
  CodingAuthorityError,
  codingPtyMaxPerTenant,
  codingTerminalGlobalLimit,
  codingTerminalTenantLimit,
  isCodingAuthorityError,
  resetCodingQuotaStateForTests,
} from "../coding/coding-quota.js";
import {
  invalidateCodingKillSwitchCache,
  setGlobalCodingKill,
} from "../coding/coding-kill-switch.js";

describe("coding quota concurrency", () => {
  beforeEach(() => {
    resetCodingQuotaStateForTests();
    invalidateCodingKillSwitchCache();
    vi.stubEnv("CODING_TERMINAL_GLOBAL_CONCURRENCY", "1");
    vi.stubEnv("CODING_TERMINAL_TENANT_CONCURRENCY", "1");
    vi.stubEnv("CODING_PTY_MAX_PER_TENANT", "2");
    vi.stubEnv("DEPLOYMENT_MODE", "hub");
    vi.stubEnv("INSTALLATION_SURFACE", "saas");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetCodingQuotaStateForTests();
    invalidateCodingKillSwitchCache();
  });

  it("exposes hub/saas default limits from env", () => {
    expect(codingTerminalGlobalLimit()).toBe(1);
    expect(codingTerminalTenantLimit()).toBe(1);
    expect(codingPtyMaxPerTenant()).toBe(2);
  });

  it("rejects when global terminal slot is taken", () => {
    const release = acquireTerminalSlot("tenant-a");
    expect(() => acquireTerminalSlot("tenant-b")).toThrow(CodingAuthorityError);
    try {
      acquireTerminalSlot("tenant-b");
    } catch (err) {
      expect(isCodingAuthorityError(err)).toBe(true);
      if (isCodingAuthorityError(err)) {
        expect(err.code).toBe("quota:global_terminal");
      }
    }
    release();
    expect(() => acquireTerminalSlot("tenant-b")).not.toThrow();
  });

  it("rejects pty when open count at cap", () => {
    expect(() =>
      assertCodingQuota({
        tenantId: "tenant-a",
        kind: "pty",
        openPtySessions: 2,
      })
    ).toThrow(/PTY session limit/i);
  });

  it("honors global coding kill switch", () => {
    setGlobalCodingKill({ codingDisabled: true });
    expect(() =>
      assertCodingQuota({ tenantId: "tenant-a", kind: "terminal" })
    ).toThrow(/platform-wide/i);
  });
});
