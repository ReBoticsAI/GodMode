/**
 * Runtime registry for floating windows so Grid / Anchor can address many of them.
 */

import { getFloatingWindowBounds } from "@/lib/floating-window-bounds";
import type { AnchorBounds } from "@/lib/floating-window-anchors";
import type { GridRect } from "@/lib/floating-window-grid";
import {
  defaultFocusAxisX,
  mirrorRectAcrossFocusX,
  snapRectToGrid,
} from "@/lib/floating-window-grid";

export type FloatingWindowRole = "chat" | "information" | "generic";

export type FloatingWindowRegistration = {
  id: string;
  role: FloatingWindowRole;
  /** Windows that mirror each other across the focus node. */
  pairGroup?: "focus-pair";
  getLayout: () => GridRect | null;
  applyLayout: (rect: GridRect) => void;
  /** Mark this window as the last one the user interacted with. */
  setActive?: () => void;
};

const registry = new Map<string, FloatingWindowRegistration>();
let lastActiveId: string | null = null;
let listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function subscribeFloatingWindowRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function registerFloatingWindow(entry: FloatingWindowRegistration): () => void {
  registry.set(entry.id, entry);
  emit();
  return () => {
    if (registry.get(entry.id) === entry) {
      registry.delete(entry.id);
      if (lastActiveId === entry.id) lastActiveId = null;
      emit();
    }
  };
}

export function setActiveFloatingWindow(id: string) {
  lastActiveId = id;
  emit();
}

export function getActiveFloatingWindowId(): string | null {
  return lastActiveId;
}

export function listFloatingWindows(): FloatingWindowRegistration[] {
  return [...registry.values()];
}

export function getFloatingWindow(id: string): FloatingWindowRegistration | undefined {
  return registry.get(id);
}

export type AnchorResult = {
  sourceId: string;
  mirroredId: string | null;
  source: GridRect;
  mirrored: GridRect | null;
};

/**
 * Snap `sourceId` to the XY grid, then mirror its focus-pair partner
 * across the focused-node X axis (content center by default).
 */
export function anchorWindowAndMirror(
  sourceId: string,
  opts?: { focusX?: number; bounds?: AnchorBounds }
): AnchorResult | null {
  const sourceReg = registry.get(sourceId);
  if (!sourceReg) return null;
  const layout = sourceReg.getLayout();
  if (!layout) return null;

  const bounds = opts?.bounds ?? getFloatingWindowBounds();
  const focusX = opts?.focusX ?? defaultFocusAxisX(bounds);
  const snapped = snapRectToGrid(layout, bounds);
  sourceReg.applyLayout({
    x: snapped.x,
    y: snapped.y,
    width: snapped.width,
    height: snapped.height,
  });
  lastActiveId = sourceId;

  let mirroredId: string | null = null;
  let mirrored: GridRect | null = null;
  if (sourceReg.pairGroup) {
    const partner = [...registry.values()].find(
      (r) =>
        r.id !== sourceId &&
        r.pairGroup === sourceReg.pairGroup &&
        r.getLayout() != null
    );
    if (partner) {
      mirrored = snapRectToGrid(
        mirrorRectAcrossFocusX(snapped, focusX, bounds),
        bounds
      );
      partner.applyLayout({
        x: mirrored.x,
        y: mirrored.y,
        width: mirrored.width,
        height: mirrored.height,
      });
      mirroredId = partner.id;
    }
  }

  emit();
  return {
    sourceId,
    mirroredId,
    source: snapped,
    mirrored,
  };
}

/** Prefer last-active window; else chat; else first registered with a layout. */
export function resolveDefaultAnchorSourceId(): string | null {
  if (lastActiveId && registry.get(lastActiveId)?.getLayout()) {
    return lastActiveId;
  }
  const chat = [...registry.values()].find(
    (r) => r.role === "chat" && r.getLayout()
  );
  if (chat) return chat.id;
  const any = [...registry.values()].find((r) => r.getLayout());
  return any?.id ?? null;
}
