/**
 * Persist floating-window x/y/width/height by registry windowId.
 * Shared by Graph chat threads, inbox, and Information windows.
 */

import { readStorageKey, writeStorageKey } from "@/lib/storage-keys";

export type SavedFloatingWindowLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const LAYOUTS_KEY = "godmode.floatingWindowLayouts";

function readAll(): Record<string, SavedFloatingWindowLayout> {
  const raw = readStorageKey(LAYOUTS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, SavedFloatingWindowLayout>;
  } catch {
    return {};
  }
}

function isValidLayout(v: unknown): v is SavedFloatingWindowLayout {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.x === "number" &&
    typeof o.y === "number" &&
    typeof o.width === "number" &&
    typeof o.height === "number" &&
    Number.isFinite(o.x) &&
    Number.isFinite(o.y) &&
    Number.isFinite(o.width) &&
    Number.isFinite(o.height) &&
    o.width > 0 &&
    o.height > 0
  );
}

export function readFloatingWindowLayout(
  windowId: string
): SavedFloatingWindowLayout | null {
  const all = readAll();
  const layout = all[windowId];
  return isValidLayout(layout) ? layout : null;
}

export function writeFloatingWindowLayout(
  windowId: string,
  layout: SavedFloatingWindowLayout
): void {
  if (!windowId || !isValidLayout(layout)) return;
  const all = readAll();
  all[windowId] = {
    x: Math.round(layout.x),
    y: Math.round(layout.y),
    width: Math.round(layout.width),
    height: Math.round(layout.height),
  };
  writeStorageKey(LAYOUTS_KEY, JSON.stringify(all));
}
