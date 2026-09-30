/**
 * Focus-pair window prefs: shared scale + tiling vs cascade mode.
 */

import {
  FOCUS_TILING_ENABLED_KEY,
  FOCUS_WINDOW_SCALE_KEY,
  readStorageKey,
  writeStorageKey,
} from "@/lib/storage-keys";

export const FOCUS_WINDOW_PREFS_EVENT = "godmode:focus-window-prefs";

export const FOCUS_WINDOW_SCALE_MIN = 0.6;
export const FOCUS_WINDOW_SCALE_MAX = 1.6;
export const FOCUS_WINDOW_SCALE_STEP = 0.1;
export const FOCUS_WINDOW_SCALE_DEFAULT = 1;

function emitPrefsChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(FOCUS_WINDOW_PREFS_EVENT));
}

function clampScale(value: number): number {
  if (!Number.isFinite(value)) return FOCUS_WINDOW_SCALE_DEFAULT;
  const stepped = Math.round(value / FOCUS_WINDOW_SCALE_STEP) * FOCUS_WINDOW_SCALE_STEP;
  return Math.min(
    FOCUS_WINDOW_SCALE_MAX,
    Math.max(FOCUS_WINDOW_SCALE_MIN, Number(stepped.toFixed(1)))
  );
}

export function getFocusWindowScale(): number {
  const raw = readStorageKey(FOCUS_WINDOW_SCALE_KEY);
  if (raw == null || raw === "") return FOCUS_WINDOW_SCALE_DEFAULT;
  const parsed = Number(raw);
  return clampScale(parsed);
}

export function setFocusWindowScale(value: number): number {
  const next = clampScale(value);
  writeStorageKey(FOCUS_WINDOW_SCALE_KEY, String(next));
  emitPrefsChange();
  return next;
}

/**
 * Bump scale by delta (typically ±0.1). Returns the new scale.
 * Does not re-layout; callers should scale open windows then applyActiveFocusLayout.
 */
export function bumpFocusWindowScale(delta: number): number {
  const old = getFocusWindowScale();
  const next = clampScale(old + delta);
  if (next === old) return next;
  writeStorageKey(FOCUS_WINDOW_SCALE_KEY, String(next));
  emitPrefsChange();
  return next;
}

export function isFocusTilingEnabled(): boolean {
  const raw = readStorageKey(FOCUS_TILING_ENABLED_KEY);
  if (raw == null || raw === "") return true;
  return raw !== "0" && raw !== "false";
}

export function setFocusTilingEnabled(on: boolean): void {
  writeStorageKey(FOCUS_TILING_ENABLED_KEY, on ? "1" : "0");
  emitPrefsChange();
}
