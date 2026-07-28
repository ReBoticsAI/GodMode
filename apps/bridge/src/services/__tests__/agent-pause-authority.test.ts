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
  assertAgentExecutionAllowed,
  isAgentPauseAuthorityError,
  AgentPauseAuthorityError,
} from "../authority/agent-pause-authority.js";
import {
  invalidateAgentPauseSwitchCache,
  setAgentPause,
  setGlobalAgentPause,
  setTenantAgentPause,
} from "../authority/agent-pause-switch.js";
import * as coreDb from "../../core-db.js";

type CoreDbMock = typeof coreDb & { __store: Map<string, string> };

function metaStore(): Map<string, string> {
  return (coreDb as CoreDbMock).__store;
}

describe("agent pause authority", () => {
  beforeEach(() => {
    metaStore().clear();
    invalidateAgentPauseSwitchCache();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    invalidateAgentPauseSwitchCache();
    metaStore().clear();
  });

  it("honors global agent pause", () => {
    setGlobalAgentPause({ agentsPaused: true });
    expect(() =>
      assertAgentExecutionAllowed({ tenantId: "t1", agentId: "intelligence" })
    ).toThrow(AgentPauseAuthorityError);
    try {
      assertAgentExecutionAllowed({ tenantId: "t1", agentId: "intelligence" });
    } catch (err) {
      expect(isAgentPauseAuthorityError(err)).toBe(true);
      if (isAgentPauseAuthorityError(err)) {
        expect(err.code).toBe("kill:global_agents");
      }
    }
  });

  it("honors tenant agent pause", () => {
    setTenantAgentPause("t1", { agentsPaused: true });
    expect(() =>
      assertAgentExecutionAllowed({ tenantId: "t1", agentId: "a1" })
    ).toThrow(/workspace/i);
    expect(() =>
      assertAgentExecutionAllowed({ tenantId: "t2", agentId: "a1" })
    ).not.toThrow();
  });

  it("honors per-agent pause", () => {
    setAgentPause("t1", "a1", { paused: true });
    expect(() =>
      assertAgentExecutionAllowed({ tenantId: "t1", agentId: "a1" })
    ).toThrow(/paused/i);
    expect(() =>
      assertAgentExecutionAllowed({ tenantId: "t1", agentId: "a2" })
    ).not.toThrow();
  });

  it("honors PLATFORM_AGENTS_DISABLED env nuclear", () => {
    vi.stubEnv("PLATFORM_AGENTS_DISABLED", "true");
    try {
      assertAgentExecutionAllowed();
      expect.unreachable("expected throw");
    } catch (err) {
      expect(isAgentPauseAuthorityError(err)).toBe(true);
      if (isAgentPauseAuthorityError(err)) {
        expect(err.code).toBe("kill:env_agents");
      }
    }
  });
});
