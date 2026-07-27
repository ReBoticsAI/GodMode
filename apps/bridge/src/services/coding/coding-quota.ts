/**
 * SaaS coding concurrency + kill-switch gate (#96 Slice 1 / former #179).
 */
import { config } from "../../config.js";
import { codingUiAllowed } from "./coding-ui-access.js";
import {
  isGlobalBuildsKillActive,
  isGlobalCodingKillActive,
  isTenantBuildsKillActive,
  isTenantCodingKillActive,
} from "./coding-kill-switch.js";

export class CodingAuthorityError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CodingAuthorityError";
    this.code = code;
  }
}

export function isCodingAuthorityError(
  err: unknown
): err is CodingAuthorityError {
  return err instanceof CodingAuthorityError;
}

export type CodingQuotaKind = "terminal" | "pty" | "build";

function parseLimit(raw: string | undefined, productionDefault: number): number {
  if (raw === undefined || raw.trim() === "") {
    return config.isProduction ? productionDefault : 0;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return productionDefault;
  return Math.floor(n);
}

export function codingTerminalGlobalLimit(): number {
  return parseLimit(
    process.env.CODING_TERMINAL_GLOBAL_CONCURRENCY,
    4
  );
}

export function codingTerminalTenantLimit(): number {
  return parseLimit(
    process.env.CODING_TERMINAL_TENANT_CONCURRENCY,
    2
  );
}

export function codingPtyMaxPerTenant(): number {
  return parseLimit(process.env.CODING_PTY_MAX_PER_TENANT, 3);
}

let globalTerminalActive = 0;
const tenantTerminalActive = new Map<string, number>();

function tenantKey(tenantId?: string | null): string {
  return String(tenantId ?? "").trim() || "local";
}

function assertCodingKill(
  tenantId: string | undefined,
  kind: CodingQuotaKind
): void {
  if (!codingUiAllowed()) {
    throw new CodingAuthorityError(
      "kill:platform_coding",
      "Coding is disabled for this installation (SaaS code access off)."
    );
  }
  if (isGlobalCodingKillActive()) {
    throw new CodingAuthorityError(
      "kill:global_coding",
      "Coding is temporarily disabled platform-wide (ops kill switch)."
    );
  }
  const tid = tenantKey(tenantId);
  if (tid !== "local" && isTenantCodingKillActive(tid)) {
    throw new CodingAuthorityError(
      "kill:tenant_coding",
      "Coding is temporarily disabled for this workspace (ops kill switch)."
    );
  }
  if (kind === "build") {
    if (isGlobalBuildsKillActive()) {
      throw new CodingAuthorityError(
        "kill:global_builds",
        "Ephemeral builds are temporarily disabled platform-wide (ops kill switch)."
      );
    }
    if (tid !== "local" && isTenantBuildsKillActive(tid)) {
      throw new CodingAuthorityError(
        "kill:tenant_builds",
        "Ephemeral builds are temporarily disabled for this workspace (ops kill switch)."
      );
    }
  }
}

function assertTerminalConcurrency(tenantId?: string | null): void {
  const globalLimit = codingTerminalGlobalLimit();
  const tenantLimit = codingTerminalTenantLimit();
  if (globalLimit > 0 && globalTerminalActive >= globalLimit) {
    throw new CodingAuthorityError(
      "quota:global_terminal",
      `Global terminal concurrency limit reached (${globalLimit}). Try again shortly.`
    );
  }
  const tid = tenantKey(tenantId);
  const active = tenantTerminalActive.get(tid) ?? 0;
  if (tenantLimit > 0 && active >= tenantLimit) {
    throw new CodingAuthorityError(
      "quota:tenant_terminal",
      `Workspace terminal concurrency limit reached (${tenantLimit}). Try again shortly.`
    );
  }
}

function assertPtyConcurrency(
  tenantId: string | null | undefined,
  openPtySessions: number
): void {
  const max = codingPtyMaxPerTenant();
  if (max <= 0) return;
  if (openPtySessions >= max) {
    throw new CodingAuthorityError(
      "quota:tenant_pty",
      `Workspace PTY session limit reached (${max}). Close a session before opening another.`
    );
  }
}

/** Fail closed before starting terminal/build/PTY work. */
export function assertCodingQuota(opts: {
  tenantId?: string | null;
  kind: CodingQuotaKind;
  /** Required when kind=pty: current open session count for the tenant. */
  openPtySessions?: number;
}): void {
  assertCodingKill(opts.tenantId ?? undefined, opts.kind);
  if (opts.kind === "terminal") {
    assertTerminalConcurrency(opts.tenantId);
  } else if (opts.kind === "pty") {
    assertPtyConcurrency(opts.tenantId, opts.openPtySessions ?? 0);
  }
}

/**
 * Acquire a terminal concurrency slot. Call release() in finally.
 * Throws CodingAuthorityError when kill or quota blocks.
 */
export function acquireTerminalSlot(tenantId?: string | null): () => void {
  assertCodingQuota({ tenantId, kind: "terminal" });
  const tid = tenantKey(tenantId);
  globalTerminalActive += 1;
  tenantTerminalActive.set(tid, (tenantTerminalActive.get(tid) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    globalTerminalActive = Math.max(0, globalTerminalActive - 1);
    const n = (tenantTerminalActive.get(tid) ?? 1) - 1;
    if (n <= 0) tenantTerminalActive.delete(tid);
    else tenantTerminalActive.set(tid, n);
  };
}

export type CodingQuotaSnapshot = {
  limits: {
    terminalGlobal: number;
    terminalTenant: number;
    ptyMaxPerTenant: number;
    buildGlobal: number;
    buildTenant: number;
    buildMode: "off" | "ephemeral";
  };
  live: {
    terminalGlobalActive: number;
    terminalByTenant: Record<string, number>;
  };
};

/** Ops visibility for Admin Authority (#96 Slice 2). */
export function getCodingQuotaSnapshot(): CodingQuotaSnapshot {
  const buildGlobal = parseLimit(
    process.env.CODING_BUILD_GLOBAL_CONCURRENCY,
    2
  );
  const buildTenant = parseLimit(
    process.env.CODING_BUILD_TENANT_CONCURRENCY,
    1
  );
  return {
    limits: {
      terminalGlobal: codingTerminalGlobalLimit(),
      terminalTenant: codingTerminalTenantLimit(),
      ptyMaxPerTenant: codingPtyMaxPerTenant(),
      buildGlobal,
      buildTenant,
      buildMode: config.codingBuildMode,
    },
    live: {
      terminalGlobalActive: globalTerminalActive,
      terminalByTenant: Object.fromEntries(tenantTerminalActive),
    },
  };
}

/** Test helper: reset in-process counters. */
export function resetCodingQuotaStateForTests(): void {
  globalTerminalActive = 0;
  tenantTerminalActive.clear();
}
