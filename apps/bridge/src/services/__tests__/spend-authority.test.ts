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
  assertSpendAllowed,
  isSpendAuthorityError,
  SpendAuthorityError,
} from "../authority/spend-authority.js";
import {
  invalidateSpendKillSwitchCache,
  setGlobalSpendKill,
  setTenantSpendKill,
} from "../authority/spend-kill-switch.js";
import { adjustCredits, CreditsError } from "../credits.js";
import * as coreDb from "../../core-db.js";

type CoreDbMock = typeof coreDb & { __store: Map<string, string> };

function metaStore(): Map<string, string> {
  return (coreDb as CoreDbMock).__store;
}

describe("spend authority hard-stop", () => {
  beforeEach(() => {
    metaStore().clear();
    invalidateSpendKillSwitchCache();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    invalidateSpendKillSwitchCache();
    metaStore().clear();
  });

  it("honors global spend kill", () => {
    setGlobalSpendKill({ spendDisabled: true });
    expect(() => assertSpendAllowed({ tenantId: "t1" })).toThrow(
      SpendAuthorityError
    );
    try {
      assertSpendAllowed({ tenantId: "t1" });
    } catch (err) {
      expect(isSpendAuthorityError(err)).toBe(true);
      if (isSpendAuthorityError(err)) {
        expect(err.code).toBe("kill:global_spend");
      }
    }
  });

  it("honors tenant spend kill", () => {
    setTenantSpendKill("t1", { spendDisabled: true });
    expect(() => assertSpendAllowed({ tenantId: "t1" })).toThrow(/workspace/i);
    expect(() => assertSpendAllowed({ tenantId: "t2" })).not.toThrow();
  });

  it("honors PLATFORM_SPEND_DISABLED env nuclear", () => {
    vi.stubEnv("PLATFORM_SPEND_DISABLED", "true");
    try {
      assertSpendAllowed();
      expect.unreachable("expected throw");
    } catch (err) {
      expect(isSpendAuthorityError(err)).toBe(true);
      if (isSpendAuthorityError(err)) {
        expect(err.code).toBe("kill:env_spend");
      }
    }
  });

  it("blocks negative adjustCredits when spend killed", () => {
    setGlobalSpendKill({ spendDisabled: true });

    const wallets = new Map<string, number>([["u1", 100]]);
    const ledger: unknown[] = [];
    const core = {
      prepare(sql: string) {
        if (sql.includes("INSERT OR IGNORE INTO credit_wallets")) {
          return {
            run: (userId: string, initial: number) => {
              if (!wallets.has(userId)) wallets.set(userId, initial);
            },
          };
        }
        if (sql.includes("SELECT balance FROM credit_wallets")) {
          return {
            get: (userId: string) => ({ balance: wallets.get(userId) ?? 0 }),
          };
        }
        if (sql.includes("UPDATE credit_wallets")) {
          return {
            run: (next: number, userId: string) => {
              wallets.set(userId, next);
            },
          };
        }
        if (sql.includes("INSERT INTO credit_ledger")) {
          return {
            run: (...args: unknown[]) => {
              ledger.push(args);
            },
          };
        }
        throw new Error(`unexpected sql: ${sql}`);
      },
      transaction: (fn: () => number) => fn,
    };

    expect(() =>
      adjustCredits(core as never, {
        userId: "u1",
        delta: -10,
        reason: "test",
        tenantId: "t1",
      })
    ).toThrow(CreditsError);

    try {
      adjustCredits(core as never, {
        userId: "u1",
        delta: -10,
        reason: "test",
        tenantId: "t1",
      });
    } catch (err) {
      expect(err).toBeInstanceOf(CreditsError);
      if (err instanceof CreditsError) {
        expect(err.code).toBe("kill:global_spend");
        expect(err.status).toBe(403);
      }
    }
    expect(wallets.get("u1")).toBe(100);
    expect(ledger).toHaveLength(0);

    setGlobalSpendKill({ spendDisabled: false });
    invalidateSpendKillSwitchCache();
    const next = adjustCredits(core as never, {
      userId: "u1",
      delta: 5,
      reason: "credit",
    });
    expect(next).toBe(105);
  });
});
