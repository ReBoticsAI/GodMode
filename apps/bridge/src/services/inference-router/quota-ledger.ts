import { getCloudDb, getPlatformMeta, setPlatformMeta } from "../../core-db.js";
import type { RosterCaps, RosterEntry } from "./types.js";

const META_LEDGER = "godmode_inference.auto_quota_ledger_json";

type ProviderDay = {
  day: string;
  requests: number;
  tokens: number;
  exhaustedUntil?: number;
};

type LedgerState = {
  /** provider -> day counters */
  byProvider: Record<string, ProviderDay>;
  /** rolling minute windows: provider -> timestamps */
  minuteHits: Record<string, number[]>;
};

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function emptyState(): LedgerState {
  return { byProvider: {}, minuteHits: {} };
}

function loadLedger(): LedgerState {
  try {
    const raw = getPlatformMeta(getCloudDb(), META_LEDGER);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as LedgerState;
    if (!parsed || typeof parsed !== "object") return emptyState();
    return {
      byProvider:
        parsed.byProvider && typeof parsed.byProvider === "object"
          ? parsed.byProvider
          : {},
      minuteHits:
        parsed.minuteHits && typeof parsed.minuteHits === "object"
          ? parsed.minuteHits
          : {},
    };
  } catch {
    return emptyState();
  }
}

function saveLedger(state: LedgerState): void {
  try {
    setPlatformMeta(getCloudDb(), META_LEDGER, JSON.stringify(state));
  } catch {
    // Cloud DB may be unavailable in unit tests.
  }
}

function providerDay(
  state: LedgerState,
  provider: string,
  day = utcDay()
): ProviderDay {
  const cur = state.byProvider[provider];
  if (!cur || cur.day !== day) {
    const next: ProviderDay = { day, requests: 0, tokens: 0 };
    state.byProvider[provider] = next;
    return next;
  }
  return cur;
}

function pruneMinute(hits: number[], now = Date.now()): number[] {
  const cutoff = now - 60_000;
  return hits.filter((t) => t >= cutoff);
}

export type QuotaSnapshot = {
  provider: string;
  day: string;
  requests: number;
  tokens: number;
  rpmWindow: number;
  exhausted: boolean;
  exhaustedUntil: number | null;
};

export function getQuotaSnapshot(provider: string): QuotaSnapshot {
  const state = loadLedger();
  const day = utcDay();
  const pd = providerDay(state, provider, day);
  const now = Date.now();
  const hits = pruneMinute(state.minuteHits[provider] ?? [], now);
  const exhausted = Boolean(pd.exhaustedUntil && pd.exhaustedUntil > now);
  return {
    provider,
    day,
    requests: pd.requests,
    tokens: pd.tokens,
    rpmWindow: hits.length,
    exhausted,
    exhaustedUntil: exhausted ? (pd.exhaustedUntil ?? null) : null,
  };
}

export function listQuotaSnapshots(providers: string[]): QuotaSnapshot[] {
  return providers.map(getQuotaSnapshot);
}

export function isRosterEntryWithinQuota(
  entry: RosterEntry,
  caps: RosterCaps = entry.caps
): boolean {
  const snap = getQuotaSnapshot(entry.provider);
  if (snap.exhausted) return false;
  if (caps.rpd != null && snap.requests >= caps.rpd) return false;
  if (caps.tpd != null && snap.tokens >= caps.tpd) return false;
  if (caps.rpm != null && snap.rpmWindow >= caps.rpm) return false;
  return true;
}

export function recordQuotaAttempt(
  provider: string,
  opts?: { tokens?: number; exhausted?: boolean; exhaustedMs?: number }
): QuotaSnapshot {
  const state = loadLedger();
  const now = Date.now();
  const pd = providerDay(state, provider);
  pd.requests += 1;
  if (opts?.tokens && opts.tokens > 0) {
    pd.tokens += Math.floor(opts.tokens);
  }
  if (opts?.exhausted) {
    pd.exhaustedUntil = now + (opts.exhaustedMs ?? 60_000);
  }
  const hits = pruneMinute(state.minuteHits[provider] ?? [], now);
  hits.push(now);
  state.minuteHits[provider] = hits;
  state.byProvider[provider] = pd;
  saveLedger(state);
  return getQuotaSnapshot(provider);
}

export function markProviderExhausted(
  provider: string,
  exhaustedMs = 60_000
): void {
  recordQuotaAttempt(provider, { exhausted: true, exhaustedMs });
}

/** Test helper: wipe ledger. */
export function resetQuotaLedgerForTests(): void {
  try {
    getCloudDb()
      .prepare(`DELETE FROM platform_meta WHERE key=?`)
      .run(META_LEDGER);
  } catch {
    // ignore
  }
}
