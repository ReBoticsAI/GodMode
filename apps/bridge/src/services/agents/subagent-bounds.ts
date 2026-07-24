/**
 * Shared wall-clock bounds for subagent runs (#70 / #118).
 * Chat, workflows, and hooks use {@link runBoundedSubagentDelegation}.
 * Autonomous ticks use {@link raceWithTimeout} only (different recovery semantics).
 */

import { runSubagent, type RunSubagentOptions } from "./runner.js";

/** Default wall-clock cap for chat / workflow / hook subagent runs. */
export const DELEGATE_DEFAULT_TIMEOUT_MS = 120_000;
/** Hard ceiling for optional `timeoutMs` overrides. */
export const DELEGATE_MAX_TIMEOUT_MS = 300_000;

/** Sentinel returned by {@link raceWithTimeout} when the deadline fires. */
export const TIMEOUT_SENTINEL = Symbol("timeout");

export async function raceWithTimeout<T>(
  p: Promise<T>,
  ms: number
): Promise<T | typeof TIMEOUT_SENTINEL> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT_SENTINEL), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type DelegateSubagentResult = {
  agentId: string;
  status: "ok" | "timeout" | "error";
  answer?: string;
  error?: string;
  durationMs: number;
};

/**
 * Run a subagent promise with a wall-clock timeout and structured status.
 */
export async function runBoundedSubagentDelegation(opts: {
  agentId: string;
  run: () => Promise<string>;
  timeoutMs?: number;
}): Promise<DelegateSubagentResult> {
  const raw =
    opts.timeoutMs != null && Number.isFinite(opts.timeoutMs)
      ? Number(opts.timeoutMs)
      : DELEGATE_DEFAULT_TIMEOUT_MS;
  const timeoutMs = Math.min(
    Math.max(1, Math.floor(raw)),
    DELEGATE_MAX_TIMEOUT_MS
  );
  const started = Date.now();
  try {
    const raced = await raceWithTimeout(opts.run(), timeoutMs);
    const durationMs = Date.now() - started;
    if (raced === TIMEOUT_SENTINEL) {
      return {
        agentId: opts.agentId,
        status: "timeout",
        error: `Subagent timed out after ${timeoutMs}ms`,
        durationMs,
      };
    }
    return {
      agentId: opts.agentId,
      status: "ok",
      answer: raced,
      durationMs,
    };
  } catch (err) {
    return {
      agentId: opts.agentId,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    };
  }
}

/** Convenience: `runSubagent` + {@link runBoundedSubagentDelegation}. */
export async function runSubagentBounded(
  opts: RunSubagentOptions & { timeoutMs?: number }
): Promise<DelegateSubagentResult> {
  const { timeoutMs, ...runOpts } = opts;
  return runBoundedSubagentDelegation({
    agentId: runOpts.agentId,
    timeoutMs,
    run: () => runSubagent(runOpts),
  });
}
