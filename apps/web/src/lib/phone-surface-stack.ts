/**
 * Phone (&lt;640px) single-window back stack synced to History.
 * Desktop multi-window is unchanged; all APIs no-op off phone.
 *
 * Model:
 * - Navigate pushes the current surface, then shows the next one.
 * - X dismisses to Graph but keeps the closed surface on the stack.
 * - Back pops the stack; if empty, always opens Social (Chat), never Graph.
 * - Back is hidden while already on Social Chat with an empty stack.
 *
 * History pushState only exists so hardware Back fires popstate. The previous
 * History entry is usually React Router / null. Pop keys off stack depth.
 */

import { isPhoneViewport } from "@/lib/graph-phone-shell";
import type { GraphProjectionNode } from "@/api";

export type PhoneSurfaceKind = "social" | "information" | "chat-thread";

export type PhoneSurfaceEntry = {
  kind: PhoneSurfaceKind;
  /** Social panel tab or Information left-rail tab (string to avoid cycles). */
  tab?: string;
  agentId?: string;
  conversationId?: string;
  canvasId?: string;
  /** Snapshot for restoring Information focus. */
  node?: GraphProjectionNode | null;
  label?: string;
};

export const PHONE_SURFACE_STACK_EVENT = "godmode:phone-surface-stack";
/** User tapped a deferred open (guide / CTA) on phone. */
export const PHONE_OPEN_SURFACE_REQUEST_EVENT =
  "godmode:phone-open-surface-request";

export const PHONE_SOCIAL_CHAT_ENTRY: PhoneSurfaceEntry = {
  kind: "social",
  tab: "chat",
  label: "Social",
};

type StackState = {
  stack: PhoneSurfaceEntry[];
  current: PhoneSurfaceEntry | null;
};

type HistoryPayload = {
  godmodePhoneSurface: true;
  gen: number;
};

const state: StackState = {
  stack: [],
  current: null,
};

let generation = 0;
let applyingHistory = false;
/** Title-bar Back already popped the stack; ignore the matching history.back(). */
let ignorePopstateCount = 0;
let restoreHandler: ((entry: PhoneSurfaceEntry | null) => void) | null = null;
let popstateBound = false;

function emit(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(PHONE_SURFACE_STACK_EVENT, {
      detail: {
        depth: state.stack.length,
        current: state.current,
        canGoBack: phoneCanGoBack(),
      },
    })
  );
}

function ensurePopstateListener(): void {
  if (popstateBound || typeof window === "undefined") return;
  popstateBound = true;
  window.addEventListener("popstate", onPopState);
}

function pushHistoryEntry(): void {
  if (typeof window === "undefined") return;
  generation += 1;
  const payload: HistoryPayload = {
    godmodePhoneSurface: true,
    gen: generation,
  };
  window.history.pushState(payload, "");
  ensurePopstateListener();
}

function syncHistoryBack(): void {
  if (typeof window === "undefined") return;
  const histState = window.history.state as HistoryPayload | null;
  if (histState?.godmodePhoneSurface === true) {
    ignorePopstateCount += 1;
    window.history.back();
  }
}

export function isPhoneSocialChatEntry(
  entry: PhoneSurfaceEntry | null | undefined
): boolean {
  if (!entry || entry.kind !== "social") return false;
  return !entry.tab || entry.tab === "chat";
}

function popStackToPrevious(): void {
  const prev = state.stack.pop() ?? null;
  state.current = prev;
  restoreHandler?.(prev);
  emit();
}

function openSocialFallback(): void {
  state.current = { ...PHONE_SOCIAL_CHAT_ENTRY };
  restoreHandler?.(state.current);
  emit();
}

function onPopState(_ev: PopStateEvent): void {
  if (!isPhoneViewport()) return;
  if (ignorePopstateCount > 0) {
    ignorePopstateCount -= 1;
    return;
  }
  if (applyingHistory) return;

  applyingHistory = true;
  try {
    if (state.stack.length > 0) {
      popStackToPrevious();
      return;
    }
    if (state.current && !isPhoneSocialChatEntry(state.current)) {
      openSocialFallback();
    }
  } finally {
    applyingHistory = false;
  }
}

/** Register how to apply a restored entry (or null = close to Graph). */
export function setPhoneSurfaceRestoreHandler(
  handler: ((entry: PhoneSurfaceEntry | null) => void) | null
): void {
  restoreHandler = handler;
  ensurePopstateListener();
}

export function getPhoneSurfaceCurrent(): PhoneSurfaceEntry | null {
  return state.current;
}

export function getPhoneSurfaceStackDepth(): number {
  return state.stack.length;
}

export function phoneCanGoBack(): boolean {
  if (!isPhoneViewport()) return false;
  if (state.stack.length > 0) return true;
  // Fallback Back → Social Chat when another surface is primary.
  return Boolean(state.current && !isPhoneSocialChatEntry(state.current));
}

/**
 * Hardware / title-bar Back.
 * Pops stack, else opens Social Chat. Never closes to bare Graph.
 */
export function phoneGoBack(): void {
  if (!isPhoneViewport() || typeof window === "undefined") return;
  if (state.stack.length > 0) {
    applyingHistory = true;
    try {
      popStackToPrevious();
    } finally {
      applyingHistory = false;
    }
    syncHistoryBack();
    return;
  }
  if (state.current && !isPhoneSocialChatEntry(state.current)) {
    applyingHistory = true;
    try {
      openSocialFallback();
    } finally {
      applyingHistory = false;
    }
  }
}

/**
 * X / dismiss to Graph. Remembers the closed surface so a later Back can
 * restore it after the user opens something else.
 */
export function dismissPhoneSurface(): void {
  if (!isPhoneViewport() || typeof window === "undefined") return;
  if (applyingHistory) {
    state.current = null;
    restoreHandler?.(null);
    emit();
    return;
  }
  if (state.current) {
    state.stack.push(state.current);
    pushHistoryEntry();
  }
  state.current = null;
  restoreHandler?.(null);
  emit();
}

/**
 * Navigate to `next`, pushing `from` (or current) so Back restores it.
 * No-op on desktop.
 */
export function pushPhoneSurface(
  next: PhoneSurfaceEntry,
  from?: PhoneSurfaceEntry | null
): void {
  if (!isPhoneViewport() || typeof window === "undefined") return;
  if (applyingHistory) {
    state.current = next;
    emit();
    return;
  }
  const prev = from ?? state.current;
  if (prev) {
    state.stack.push(prev);
    pushHistoryEntry();
  }
  state.current = next;
  ensurePopstateListener();
  emit();
}

/** Set current without pushing (land Social, restore, replace same kind). */
export function replacePhoneSurface(next: PhoneSurfaceEntry | null): void {
  if (!isPhoneViewport()) return;
  state.current = next;
  emit();
}

export function clearPhoneSurfaceStack(): void {
  state.stack = [];
  state.current = null;
  emit();
}

/** Reset module state (tests). */
export function resetPhoneSurfaceStackForTests(): void {
  state.stack = [];
  state.current = null;
  generation = 0;
  applyingHistory = false;
  ignorePopstateCount = 0;
  restoreHandler = null;
  popstateBound = false;
}

export function isApplyingPhoneHistory(): boolean {
  return applyingHistory;
}

export type PhoneOpenSurfaceRequestDetail = {
  tab: string;
  vault?: string | null;
  sub?: string | null;
  label?: string;
};

/** Defer open_surface on phone: toast/action dispatches this; openers listen. */
export function requestPhoneOpenSurface(
  detail: PhoneOpenSurfaceRequestDetail
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(PHONE_OPEN_SURFACE_REQUEST_EVENT, { detail })
  );
}
