/**
 * Runtime registry for floating windows so Grid / Anchor can address many of them.
 */

import { getFloatingWindowBounds, getMaximizedFocusBounds } from "@/lib/floating-window-bounds";
import type { AnchorBounds } from "@/lib/floating-window-anchors";
import {
  focusWindowAnchors,
  layoutCascadeStack,
  layoutCenteredFocusCluster,
  layoutMaximizedFocusCluster,
} from "@/lib/floating-window-anchors";
import {
  getFocusWindowScale,
  isFocusTilingEnabled,
} from "@/lib/floating-window-focus-prefs";
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
/** Index 0 is the large focus tile. The rest are the right-side tiles, in order. */
let focusSlotOrder: string[] | null = null;
let focusLayoutMaximized = false;
let focusRestoreLayouts: Map<string, GridRect> | null = null;

export const FOCUS_LAYOUT_MAXIMIZED_EVENT = "godmode:focus-layout-maximized";

function emitMaximizedChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(FOCUS_LAYOUT_MAXIMIZED_EVENT));
}

export function isFocusLayoutMaximized(): boolean {
  return focusLayoutMaximized;
}

/** Keep known slots, drop closed windows, and append newly opened ones at the end. */
export function mergeFocusSlotOrder(
  previous: string[] | null,
  presentIds: string[]
): string[] {
  const present = new Set(presentIds);
  const kept = (previous ?? []).filter((id) => present.has(id));
  for (const id of presentIds) {
    if (!kept.includes(id)) kept.push(id);
  }
  return kept;
}

/** Swap two window ids in the focus slot list. Index 0 stays the large tile. */
export function swapFocusSlotIds(
  order: string[],
  a: string,
  b: string
): string[] | null {
  const i = order.indexOf(a);
  const j = order.indexOf(b);
  if (i < 0 || j < 0 || i === j) return null;
  const next = order.slice();
  const tmp = next[i]!;
  next[i] = next[j]!;
  next[j] = tmp;
  return next;
}

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
    }
    emit();
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

function listFocusPairEntries(): {
  chat: FloatingWindowRegistration | undefined;
  companions: FloatingWindowRegistration[];
} {
  const chat = [...registry.values()].find(
    (r) => r.role === "chat" && r.getLayout() != null
  );
  const companions = [...registry.values()]
    .filter((r) => r.role === "information" && r.getLayout() != null)
    .sort((a, b) => a.id.localeCompare(b.id));
  return { chat, companions };
}

function presentFocusIds(
  chat: FloatingWindowRegistration | undefined,
  companions: FloatingWindowRegistration[]
): string[] {
  return [...(chat ? [chat.id] : []), ...companions.map((c) => c.id)];
}

function orderedFocusEntries(): FloatingWindowRegistration[] {
  const { chat, companions } = listFocusPairEntries();
  const byId = new Map<string, FloatingWindowRegistration>();
  if (chat) byId.set(chat.id, chat);
  for (const companion of companions) byId.set(companion.id, companion);
  focusSlotOrder = mergeFocusSlotOrder(
    focusSlotOrder,
    presentFocusIds(chat, companions)
  );
  return focusSlotOrder
    .map((id) => byId.get(id))
    .filter((entry): entry is FloatingWindowRegistration => entry != null);
}

function focusSeedSize(entries: FloatingWindowRegistration[]): {
  width: number;
  height: number;
} {
  const scale = getFocusWindowScale();
  let best: GridRect | null = null;
  for (const entry of entries) {
    const layout = entry.getLayout();
    if (!layout) continue;
    if (!best || layout.width * layout.height > best.width * best.height) {
      best = layout;
    }
  }
  return {
    width: best?.width ?? Math.round(560 * scale),
    height: best?.height ?? Math.round(480 * scale),
  };
}

/**
 * Title bar under the pointer, skipping the window being dragged.
 * Uses the full hit stack so the dragged window does not hide the target.
 */
export function floatingTitleWindowIdAt(
  clientX: number,
  clientY: number,
  sourceId: string
): string | null {
  if (typeof document === "undefined" || !document.elementsFromPoint) return null;
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const el of stack) {
    if (!(el instanceof Element)) continue;
    const title = el.closest("[data-floating-title]");
    const id = title?.getAttribute("data-window-id");
    if (id && id !== sourceId) return id;
  }
  return null;
}

export function setTileSwapHighlight(windowId: string | null): void {
  if (typeof document === "undefined") return;
  document.querySelectorAll("[data-tile-swap-target]").forEach((el) => {
    el.removeAttribute("data-tile-swap-target");
  });
  if (!windowId) return;
  const title = document.querySelector(
    `[data-floating-title][data-window-id="${CSS.escape(windowId)}"]`
  );
  title?.setAttribute("data-tile-swap-target", "true");
}

/** Drop a title-bar swap so the next layout puts chat back in the large tile. */
export function resetFocusSlotOrder(): void {
  focusSlotOrder = null;
  if (focusLayoutMaximized && focusRestoreLayouts) {
    for (const [id, rect] of focusRestoreLayouts) {
      registry.get(id)?.applyLayout({ ...rect });
    }
  }
  if (focusLayoutMaximized || focusRestoreLayouts) {
    focusLayoutMaximized = false;
    focusRestoreLayouts = null;
    emitMaximizedChange();
  }
}

/** Exchange two focus tiles, then re-lay the cluster. Index 0 is the large tile. */
export function swapFocusWindowSlots(sourceId: string, targetId: string): boolean {
  const ids = orderedFocusEntries().map((entry) => entry.id);
  const next = swapFocusSlotIds(ids, sourceId, targetId);
  if (!next) return false;
  focusSlotOrder = next;
  applyActiveFocusLayout();
  return true;
}

/**
 * Multiply width/height of all open focus-pair windows by `ratio`
 * (used when bumping the shared scale). Positions stay put until retile/cascade.
 */
export function scaleFocusPairWindows(ratio: number): void {
  if (!Number.isFinite(ratio) || ratio === 1) return;
  const bounds = getFloatingWindowBounds();
  const { chat, companions } = listFocusPairEntries();
  const all = [chat, ...companions].filter(
    (r): r is FloatingWindowRegistration => r != null
  );
  for (const reg of all) {
    const layout = reg.getLayout();
    if (!layout) continue;
    const width = Math.max(
      160,
      Math.min(Math.round(layout.width * ratio), bounds.width - 24)
    );
    const height = Math.max(
      160,
      Math.min(Math.round(layout.height * ratio), bounds.height - 16)
    );
    reg.applyLayout({
      x: layout.x,
      y: layout.y,
      width,
      height,
    });
  }
  emit();
}

/**
 * Focus cluster: slot 0 is the large tile, the rest are the right-side tiles.
 * A title-bar swap changes which window owns the large tile.
 */
export function retileFocusLayout(opts?: {
  bounds?: AnchorBounds;
  focusX?: number;
}): void {
  const bounds = opts?.bounds ?? getFloatingWindowBounds();
  const ordered = orderedFocusEntries();
  if (ordered.length === 0) return;

  const seed = focusSeedSize(ordered);
  const focusX = opts?.focusX ?? defaultFocusAxisX(bounds);
  const [primary, ...rest] = ordered;

  const cluster = layoutCenteredFocusCluster(
    bounds,
    seed.width,
    seed.height,
    rest.length,
    focusX
  );

  primary?.applyLayout(cluster.chat);
  rest.forEach((reg, i) => {
    const tile = cluster.companions[i];
    if (!tile) return;
    reg.applyLayout(tile);
  });
  emit();
}

/**
 * Offset-stack Information windows on the focus-right side (tiling off).
 * Chat stays on the focus-left side of the highlighted node.
 */
export function cascadeFocusLayout(opts?: {
  bounds?: AnchorBounds;
  focusX?: number;
}): void {
  const bounds = opts?.bounds ?? getFloatingWindowBounds();
  const ordered = orderedFocusEntries();
  if (ordered.length === 0) return;

  const seed = focusSeedSize(ordered);
  const focusX = opts?.focusX ?? defaultFocusAxisX(bounds);
  const [primary, ...rest] = ordered;

  if (primary) {
    const left = focusWindowAnchors(
      bounds,
      seed.width,
      seed.height,
      focusX
    ).left;
    primary.applyLayout({
      x: left.x,
      y: left.y,
      width: Math.round(seed.width),
      height: Math.round(seed.height),
    });
  }

  if (rest.length > 0) {
    const rects = layoutCascadeStack(
      bounds,
      seed.width,
      seed.height,
      rest.length,
      focusX,
      "right"
    );
    rest.forEach((reg, i) => {
      const rect = rects[i];
      if (!rect) return;
      reg.applyLayout(rect);
    });
  }
  emit();
}

/** Apply tiling or cascade based on the current preference. */
export function applyActiveFocusLayout(opts?: {
  bounds?: AnchorBounds;
  focusX?: number;
}): void {
  if (isFocusTilingEnabled() && focusLayoutMaximized) {
    applyMaximizedFocusLayout();
    return;
  }
  if (isFocusTilingEnabled()) {
    retileFocusLayout(opts);
  } else {
    cascadeFocusLayout(opts);
  }
}

/** Fill the playfield between the side rails, under the notices, above the reply pill. */
export function applyMaximizedFocusLayout(): void {
  const ordered = orderedFocusEntries();
  if (ordered.length === 0) return;
  const [primary, ...rest] = ordered;
  const cluster = layoutMaximizedFocusCluster(
    getMaximizedFocusBounds(),
    rest.length
  );
  primary?.applyLayout(cluster.chat);
  rest.forEach((reg, i) => {
    const tile = cluster.companions[i];
    if (!tile) return;
    reg.applyLayout(tile);
  });
  emit();
}

/**
 * Stretch tiled windows to the chrome edges, or put them back.
 * Returns whether they are maximized after the toggle.
 */
export function toggleFocusLayoutMaximized(): boolean {
  if (!isFocusTilingEnabled()) return false;
  if (focusLayoutMaximized) {
    const saved = focusRestoreLayouts;
    focusLayoutMaximized = false;
    focusRestoreLayouts = null;
    const ordered = orderedFocusEntries();
    const canRestore =
      saved != null &&
      ordered.length > 0 &&
      ordered.every((entry) => saved.has(entry.id));
    if (canRestore && saved) {
      for (const entry of ordered) {
        const rect = saved.get(entry.id);
        if (rect) entry.applyLayout(rect);
      }
      emit();
    } else {
      retileFocusLayout();
    }
    emitMaximizedChange();
    return false;
  }

  const ordered = orderedFocusEntries();
  const saved = new Map<string, GridRect>();
  for (const entry of ordered) {
    const layout = entry.getLayout();
    if (layout) saved.set(entry.id, { ...layout });
  }
  focusRestoreLayouts = saved;
  focusLayoutMaximized = true;
  applyMaximizedFocusLayout();
  emitMaximizedChange();
  return true;
}
