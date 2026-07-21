import type { IRouter, Request } from "express";

/** Opaque tenant SQLite handle — plugins must not cast without bridge types. */
export type TenantDb = unknown;

/** Plugin-registered scheduler hooks (e.g. optimization card phases). */
export interface PluginSchedulerHost {
  finalizeCombinePhaseIfComplete: (...args: unknown[]) => unknown;
  finalizeOosPhaseIfComplete: (...args: unknown[]) => unknown;
  finalizeSweepPhaseIfComplete: (...args: unknown[]) => unknown;
  isCombinePhaseSubtask: (subtask: { title: string }) => boolean;
  isMultiBacktestSubtask: (subtask: { title: string }) => boolean;
  isOosPhaseSubtask: (subtask: { title: string }) => boolean;
  isSweepPhaseSubtask: (subtask: { title: string }) => boolean;
  recordCompletedCombineRun: (...args: unknown[]) => unknown;
  recordCompletedOosRun: (...args: unknown[]) => unknown;
  recordCompletedSweepRun: (...args: unknown[]) => unknown;
  syncCombineCursorFromRuns: (...args: unknown[]) => unknown;
  syncOosCursorFromRuns: (...args: unknown[]) => unknown;
  syncSweepCursorFromRuns: (...args: unknown[]) => unknown;
  tryDeterministicCombineKick: (...args: unknown[]) => Promise<unknown>;
  tryDeterministicOosKick: (...args: unknown[]) => Promise<unknown>;
  tryDeterministicSweepKick: (...args: unknown[]) => Promise<unknown>;
}

export interface SystemEventRow {
  type: string;
  payload_json: string | null;
}

export interface CardAwaitingHost {
  findCardsAwaitingRef(
    db: TenantDb,
    kind: string,
    refId: string
  ): Array<{ id: string }>;
  markCardAwaitingTerminal(
    db: TenantDb,
    cardId: string,
    payload: Record<string, unknown>
  ): void;
  appendCardComment(
    db: TenantDb,
    cardId: string,
    text: string,
    kind: string
  ): void;
}

export type HealthProbeFn = () => Promise<{ ok: boolean; detail?: string }>;
export type IpcEnqueueFn = (line: string, chartbookKey?: string) => string;

export interface PluginHostServices {
  getTenantDb(tenantId: string): TenantDb;
  getReqTenantDb(req: Request): TenantDb;
  createPluginRouter(): IRouter;
  getTimeseriesStore(): {
    analyticsQuery(sql: string): Promise<unknown[]>;
    append(
      dataset: string,
      symbol: string,
      row: Record<string, string | number | boolean | null>
    ): void;
  };
  bootstrapTradingDepartment(db: TenantDb): void;
  bridgeFetch(path: string, init?: RequestInit): Promise<Response>;
  emitPlatformEvent?(input: {
    type: string;
    actor: { kind: string; id?: string | null };
    payload?: Record<string, unknown>;
    tenantId?: string | null;
  }): void;

  /** Register a named health probe (plugins choose ids, e.g. "chart-ipc"). */
  registerHealthProbe?(id: string, fn: HealthProbeFn): void;
  pingHealthProbe?(id: string): Promise<{ ok: boolean; detail?: string }>;

  /** Register a named IPC line enqueue handler. */
  registerIpcEnqueue?(id: string, fn: IpcEnqueueFn): void;
  enqueueIpcLine?(id: string, line: string, chartbookKey?: string): string;

  /** Register a named scheduler host for autonomous card phases. */
  getPluginScheduler?(id: string): PluginSchedulerHost | null;
  registerPluginScheduler?(id: string, api: PluginSchedulerHost): void;

  /** Durable system event side-effects (e.g. backtest terminal → Kanban). */
  registerSystemEventHandler?(
    fn: (event: SystemEventRow) => void
  ): void;
  dispatchSystemEventHandlers?(event: SystemEventRow): void;
  cardAwaiting?: CardAwaitingHost;
  kickAutonomousRunner?(reason?: string): void;
  registerAutonomousRunnerKick?(fn: (reason?: string) => void): void;
}
