import { useEffect, useState } from "react";
import { fetchAiStatus, type AiStatus } from "../api";

const POLL_MS = 4_000;

let cached: AiStatus | null = null;
const listeners = new Set<(s: AiStatus | null) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function pull(): void {
  fetchAiStatus()
    .then((s) => {
      cached = s;
      for (const fn of listeners) fn(s);
    })
    .catch(() => {
      for (const fn of listeners) fn(cached);
    });
}

function ensurePolling(): void {
  if (timer || listeners.size === 0) return;
  pull();
  timer = setInterval(pull, POLL_MS);
}

function stopPolling(): void {
  if (!timer || listeners.size > 0) return;
  clearInterval(timer);
  timer = null;
}

/** Shared poller for `/api/ai/status`, mirroring use-session-status. */
export function useAiStatus(): { status: AiStatus | null; refresh: () => void } {
  const [s, setS] = useState<AiStatus | null>(cached);
  useEffect(() => {
    listeners.add(setS);
    ensurePolling();
    return () => {
      listeners.delete(setS);
      stopPolling();
    };
  }, []);
  return { status: s, refresh: pull };
}
