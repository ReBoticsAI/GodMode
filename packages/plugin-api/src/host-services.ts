import type { IRouter, Request } from "express";

/** Opaque tenant SQLite handle — plugins must not cast without bridge types. */
export type TenantDb = unknown;

export interface SierraPb1SchedulerHost {
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
  tryDeterministicPb1CombineKick: (...args: unknown[]) => Promise<unknown>;
  tryDeterministicPb1OosKick: (...args: unknown[]) => Promise<unknown>;
  tryDeterministicPb1SweepKick: (...args: unknown[]) => Promise<unknown>;
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

export interface PluginHostServices {
  getTenantDb(tenantId: string): TenantDb;
  getReqTenantDb(req: Request): TenantDb;
  createPluginRouter(): IRouter;
  getTimeseriesStore(): {
    analyticsQuery(sql: string): Promise<unknown[]>;
  };
  bootstrapTradingDepartment(db: TenantDb): void;
  bridgeFetch(path: string, init?: RequestInit): Promise<Response>;
  emitPlatformEvent?(input: {
    type: string;
    actor: { kind: string; id?: string | null };
    payload?: Record<string, unknown>;
    tenantId?: string | null;
  }): void;
  pingScHealth?(): Promise<{ ok: boolean; detail?: string }>;
  registerScHealthPing?(
    fn: () => Promise<{ ok: boolean; detail?: string }>
  ): void;
  /** Sierra Chart IPC command queue (plugin registers when loaded). */
  enqueueScLine?(
    line: string,
    chartbookKey?: string
  ): string;
  registerEnqueueScLine?(
    fn: (line: string, chartbookKey?: string) => string
  ): void;
  /** PB1 optimization scheduler hooks for autonomous executor. */
  getSierraPb1Scheduler?(): SierraPb1SchedulerHost | null;
  registerSierraPb1Scheduler?(api: SierraPb1SchedulerHost): void;
  /** Durable system event side-effects (e.g. backtest terminal → Kanban). */
  registerSystemEventHandler?(
    fn: (event: SystemEventRow) => void
  ): void;
  dispatchSystemEventHandlers?(event: SystemEventRow): void;
  cardAwaiting?: CardAwaitingHost;
  kickAutonomousRunner?(reason?: string): void;
  registerAutonomousRunnerKick?(fn: (reason?: string) => void): void;
}
