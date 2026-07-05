import { useEffect, useState } from "react";
import { api, type SessionStatus } from "../api";

const POLL_MS = 5_000;

let cached: SessionStatus | null = null;
const listeners = new Set<(s: SessionStatus | null) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function pull(): void {
  api<SessionStatus>("/session")
    .then((s) => {
      cached = s;
      for (const fn of listeners) fn(s);
    })
    .catch(() => {
      cached = cached ? { ...cached, bridge: false } : null;
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

/**
 * Shared session-status subscription. The first subscriber starts polling
 * `/api/session` every 5s and the last one to unsubscribe stops it, so the
 * universal header/footer don't each open their own request stream.
 */
export function useSessionStatus(): SessionStatus | null {
  const [s, setS] = useState<SessionStatus | null>(cached);
  useEffect(() => {
    listeners.add(setS);
    ensurePolling();
    return () => {
      listeners.delete(setS);
      stopPolling();
    };
  }, []);
  return s;
}
