/**
 * Cursor subscription CLI probe + models list TTL / single-flight caches.
 */
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDatabase } from "../../db.js";

const spawnMock = vi.hoisted(() => vi.fn());
const modelsListMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("@cursor/sdk", () => ({
  Cursor: {
    models: {
      list: modelsListMock,
    },
  },
}));

vi.mock("../agents/cursor-backend.js", () => ({
  resolveCursorAgentCommand: () => "cursor-agent",
}));

import {
  clearCursorSubscriptionCachesForTests,
  CURSOR_CLI_PROBE_NEGATIVE_TTL_MS,
  CURSOR_CLI_PROBE_TTL_MS,
  CURSOR_MODELS_TTL_MS,
  listCursorSubscriptionModels,
  peekCachedCursorCliAuth,
  probeCursorCliAuth,
  refreshCursorCliAuthInBackground,
} from "../cursor-subscription.js";

function fakeSpawnOk(detail = "Logged in as test@example.com"): void {
  spawnMock.mockImplementation(() => {
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn();
    queueMicrotask(() => {
      proc.stdout.emit("data", Buffer.from(detail));
      proc.emit("close", 0);
    });
    return proc;
  });
}

beforeEach(() => {
  clearCursorSubscriptionCachesForTests();
  spawnMock.mockReset();
  modelsListMock.mockReset();
  vi.useRealTimers();
});

afterEach(() => {
  clearCursorSubscriptionCachesForTests();
  vi.useRealTimers();
});

describe("probeCursorCliAuth cache", () => {
  it("second call within TTL does not spawn again", async () => {
    fakeSpawnOk("✓ Logged in as user@example.com");
    const a = await probeCursorCliAuth();
    const b = await probeCursorCliAuth();
    expect(a.ok).toBe(true);
    expect(b).toEqual(a);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(peekCachedCursorCliAuth()?.ok).toBe(true);
  });

  it("concurrent probes share one in-flight spawn", async () => {
    fakeSpawnOk("Authenticated as concurrent@example.com");
    const [a, b, c] = await Promise.all([
      probeCursorCliAuth(),
      probeCursorCliAuth(),
      probeCursorCliAuth(),
    ]);
    expect(a.ok).toBe(true);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("refreshCursorCliAuthInBackground does not await on caller", async () => {
    fakeSpawnOk("Logged in as bg@example.com");
    expect(peekCachedCursorCliAuth()).toBeNull();
    refreshCursorCliAuthInBackground();
    expect(peekCachedCursorCliAuth()).toBeNull();
    await vi.waitFor(() => {
      expect(peekCachedCursorCliAuth()?.ok).toBe(true);
    });
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("caches negative results with shorter TTL path still single-flight", async () => {
    spawnMock.mockImplementation(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = vi.fn();
      queueMicrotask(() => {
        proc.emit("error", new Error("ENOENT"));
      });
      return proc;
    });
    const a = await probeCursorCliAuth();
    const b = await probeCursorCliAuth();
    expect(a.ok).toBe(false);
    expect(a.detail).toMatch(/not installed/i);
    expect(b).toEqual(a);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(CURSOR_CLI_PROBE_NEGATIVE_TTL_MS).toBeLessThan(CURSOR_CLI_PROBE_TTL_MS);
  });
});

describe("listCursorSubscriptionModels cache", () => {
  const db = {
    prepare: () => ({
      get: () => null,
      all: () => [],
      run: () => ({ changes: 0 }),
    }),
  } as unknown as AppDatabase;

  beforeEach(() => {
    process.env.CURSOR_API_KEY = "test-cursor-key-for-cache";
    modelsListMock.mockResolvedValue([
      { id: "composer-2.5", displayName: "Composer 2.5" },
      { id: "grok" },
    ]);
  });

  afterEach(() => {
    delete process.env.CURSOR_API_KEY;
  });

  it("second call within TTL does not list models again", async () => {
    const a = await listCursorSubscriptionModels(db);
    const b = await listCursorSubscriptionModels(db);
    expect(a.some((m) => m.id === "auto")).toBe(true);
    expect(a.some((m) => m.id === "composer-2.5")).toBe(true);
    expect(b).toEqual(a);
    expect(modelsListMock).toHaveBeenCalledTimes(1);
    expect(CURSOR_MODELS_TTL_MS).toBeGreaterThan(60_000);
  });

  it("concurrent list calls share one in-flight SDK request", async () => {
    let release!: (v: unknown[]) => void;
    modelsListMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve as (v: unknown[]) => void;
        })
    );
    const p1 = listCursorSubscriptionModels(db);
    const p2 = listCursorSubscriptionModels(db);
    await vi.waitFor(() => {
      expect(modelsListMock).toHaveBeenCalledTimes(1);
    });
    release([{ id: "composer-2.5", displayName: "Composer 2.5" }]);
    const [a, b] = await Promise.all([p1, p2]);
    expect(a).toEqual(b);
    expect(modelsListMock).toHaveBeenCalledTimes(1);
  });

  it("catalog helper returns Auto-only while refreshing cold cache", async () => {
    clearCursorSubscriptionCachesForTests();
    modelsListMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () => resolve([{ id: "composer-2.5", displayName: "Composer 2.5" }]),
            50
          );
        })
    );
    const { listCursorSubscriptionModelsForCatalog } = await import(
      "../cursor-subscription.js"
    );
    const first = listCursorSubscriptionModelsForCatalog(db);
    expect(first).toEqual([{ id: "auto", label: "Auto (Cursor picks)" }]);
    await vi.waitFor(() => {
      const warm = listCursorSubscriptionModelsForCatalog(db);
      expect(warm.some((m) => m.id === "composer-2.5")).toBe(true);
    });
  });
});
