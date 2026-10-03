/**
 * Per-floating-window content density (manual +/− on the title bar).
 * Larger values enlarge body content; smaller values pack more into the same window.
 * Independent of focus-pair window scale (outer chrome size).
 */

import { isPhoneViewport } from "@/lib/graph-phone-shell";
import { readStorageKey, writeStorageKey } from "@/lib/storage-keys";

export const WINDOW_DENSITY_KEY = "godmode.windowDensity";
export const WINDOW_DENSITY_EVENT = "godmode:window-density";

export const WINDOW_DENSITY_MIN = 0.7;
export const WINDOW_DENSITY_MAX = 1.4;
export const WINDOW_DENSITY_STEP = 0.1;
export const WINDOW_DENSITY_DEFAULT = 1;
/** First-paint default on phone when no stored pref (readable, still scrollable). */
export const WINDOW_DENSITY_PHONE_DEFAULT = 0.9;

type DensityMap = Record<string, number>;

function emitDensityChange(windowId: string, density: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WINDOW_DENSITY_EVENT, {
      detail: { windowId, density },
    })
  );
}

function clampDensity(value: number): number {
  if (!Number.isFinite(value)) return WINDOW_DENSITY_DEFAULT;
  const stepped =
    Math.round(value / WINDOW_DENSITY_STEP) * WINDOW_DENSITY_STEP;
  return Math.min(
    WINDOW_DENSITY_MAX,
    Math.max(WINDOW_DENSITY_MIN, Number(stepped.toFixed(1)))
  );
}

function readMap(): DensityMap {
  const raw = readStorageKey(WINDOW_DENSITY_KEY);
  if (raw == null || raw === "") return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: DensityMap = {};
    for (const [id, value] of Object.entries(parsed as DensityMap)) {
      if (typeof id !== "string" || !id.trim()) continue;
      if (typeof value !== "number") continue;
      out[id] = clampDensity(value);
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(map: DensityMap): void {
  writeStorageKey(WINDOW_DENSITY_KEY, JSON.stringify(map));
}

export function getWindowDensity(windowId: string): number {
  if (!windowId.trim()) {
    return isPhoneViewport()
      ? WINDOW_DENSITY_PHONE_DEFAULT
      : WINDOW_DENSITY_DEFAULT;
  }
  const map = readMap();
  if (map[windowId] != null) return map[windowId];
  return isPhoneViewport()
    ? WINDOW_DENSITY_PHONE_DEFAULT
    : WINDOW_DENSITY_DEFAULT;
}

export function setWindowDensity(windowId: string, value: number): number {
  const id = windowId.trim();
  if (!id) return WINDOW_DENSITY_DEFAULT;
  const next = clampDensity(value);
  const map = readMap();
  if (next === WINDOW_DENSITY_DEFAULT) {
    delete map[id];
  } else {
    map[id] = next;
  }
  writeMap(map);
  emitDensityChange(id, next);
  return next;
}

/** Bump density by delta (typically ±0.1). Returns the new density. */
export function bumpWindowDensity(windowId: string, delta: number): number {
  const id = windowId.trim();
  if (!id) return WINDOW_DENSITY_DEFAULT;
  const old = getWindowDensity(id);
  const next = clampDensity(old + delta);
  if (next === old) return next;
  return setWindowDensity(id, next);
}
