import type { PromptSectionId } from "@/api";

/** Every node kind shown on the AI Builder canvas. */
export type BuilderNodeKind =
  | "model"
  | "generation"
  | "thinking"
  | "adapters"
  | "training"
  | "toolMode"
  | "backend"
  | "delegation"
  | "account"
  | "permissions"
  | PromptSectionId
  | "commands";

export interface BuilderNodeData {
  kind: BuilderNodeKind;
  label: string;
  summary: string;
  /** Whether this node is a prompt section (toggle persists to backend). */
  isSection: boolean;
  enabled: boolean;
  group: "runtime" | "prompt" | "context" | "turn" | "output" | "reference";
  [key: string]: unknown;
}

export interface BuilderNodeDef {
  kind: BuilderNodeKind;
  label: string;
  group: BuilderNodeData["group"];
  /** Default canvas position. */
  pos: { x: number; y: number };
  isSection: boolean;
}

/** Prompt-section ids that the backend assembler understands. */
export const SECTION_KINDS: PromptSectionId[] = [
  "profile",
  "user",
  "base",
  "rules",
  "memory",
  "skills",
  "tools",
  "platform",
  "mentions",
  "chatHistory",
  "userMessage",
  "final",
];

export const NODE_DEFS: BuilderNodeDef[] = [
  { kind: "model", label: "Model", group: "runtime", pos: { x: 0, y: 0 }, isSection: false },
  { kind: "generation", label: "Generation", group: "runtime", pos: { x: 0, y: 120 }, isSection: false },
  { kind: "thinking", label: "Thinking", group: "runtime", pos: { x: 0, y: 240 }, isSection: false },
  { kind: "adapters", label: "Adapters", group: "runtime", pos: { x: 0, y: 360 }, isSection: false },
  { kind: "training", label: "Training", group: "runtime", pos: { x: 200, y: 600 }, isSection: false },
  { kind: "toolMode", label: "Tool Mode", group: "runtime", pos: { x: 200, y: 360 }, isSection: false },
  { kind: "backend", label: "Backend", group: "runtime", pos: { x: 200, y: 480 }, isSection: false },
  { kind: "delegation", label: "Delegation", group: "reference", pos: { x: 400, y: 480 }, isSection: false },
  { kind: "account", label: "Account", group: "reference", pos: { x: 400, y: 600 }, isSection: false },
  { kind: "permissions", label: "Permissions", group: "reference", pos: { x: 400, y: 720 }, isSection: false },
  { kind: "profile", label: "Agent Profile", group: "context", pos: { x: -200, y: 480 }, isSection: true },
  { kind: "user", label: "User Context", group: "context", pos: { x: -200, y: 600 }, isSection: true },
  { kind: "base", label: "System Prompt", group: "prompt", pos: { x: 0, y: 480 }, isSection: true },
  { kind: "rules", label: "Rules", group: "prompt", pos: { x: 280, y: 480 }, isSection: true },
  { kind: "memory", label: "Memory", group: "prompt", pos: { x: 520, y: 480 }, isSection: true },
  { kind: "skills", label: "Skills Index", group: "prompt", pos: { x: 760, y: 480 }, isSection: true },
  { kind: "tools", label: "Tools", group: "prompt", pos: { x: 1000, y: 480 }, isSection: true },
  { kind: "platform", label: "Page Context", group: "context", pos: { x: 1240, y: 400 }, isSection: true },
  { kind: "mentions", label: "@ Mentions", group: "context", pos: { x: 1240, y: 540 }, isSection: true },
  { kind: "chatHistory", label: "Chat History", group: "turn", pos: { x: 1240, y: 240 }, isSection: true },
  { kind: "userMessage", label: "User Message", group: "turn", pos: { x: 1480, y: 240 }, isSection: true },
  { kind: "commands", label: "Chat Commands", group: "reference", pos: { x: 600, y: 360 }, isSection: false },
  { kind: "final", label: "Final LLM Request", group: "output", pos: { x: 1520, y: 460 }, isSection: true },
];

/** Pipeline edges (drawn when both ends are present & enabled). */
export const BUILDER_EDGES: Array<[BuilderNodeKind, BuilderNodeKind]> = [
  ["profile", "base"],
  ["user", "base"],
  ["base", "rules"],
  ["rules", "memory"],
  ["memory", "skills"],
  ["skills", "tools"],
  ["tools", "platform"],
  ["tools", "mentions"],
  ["platform", "final"],
  ["mentions", "final"],
  ["chatHistory", "userMessage"],
  ["userMessage", "final"],
  ["model", "final"],
  ["generation", "final"],
  ["thinking", "final"],
  ["adapters", "final"],
  ["training", "final"],
  ["toolMode", "final"],
  ["commands", "final"],
];

import {
  BUILDER_POSITIONS_KEY,
  LEGACY_BUILDER_POSITIONS_KEY,
  readMigratedKey,
  writeMigratedKey,
} from "@/lib/storage-keys";

const POSITIONS_KEY = BUILDER_POSITIONS_KEY;

export function loadPositions(): Record<string, { x: number; y: number }> {
  if (typeof window === "undefined") return {};
  try {
    const raw = readMigratedKey(POSITIONS_KEY, LEGACY_BUILDER_POSITIONS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, { x: number; y: number }>) : {};
  } catch {
    return {};
  }
}

export function savePositions(pos: Record<string, { x: number; y: number }>): void {
  if (typeof window === "undefined") return;
  writeMigratedKey(POSITIONS_KEY, LEGACY_BUILDER_POSITIONS_KEY, JSON.stringify(pos));
}

const ORGCHART_POSITIONS_KEY = "intelligence-orgchart-positions";

export function loadOrgChartPositions(): Record<string, { x: number; y: number }> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(ORGCHART_POSITIONS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, { x: number; y: number }>) : {};
  } catch {
    return {};
  }
}

export function saveOrgChartPositions(pos: Record<string, { x: number; y: number }>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ORGCHART_POSITIONS_KEY, JSON.stringify(pos));
}

export function clearOrgChartPositions(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ORGCHART_POSITIONS_KEY);
}

const ORGCHART_COLLAPSED_KEY = "intelligence-orgchart-collapsed";

/**
 * Returns the persisted set of collapsed node ids, or `null` when nothing has
 * been saved yet (so callers can fall back to the default department-level view).
 */
export function loadOrgChartCollapsed(): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ORGCHART_COLLAPSED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

export function saveOrgChartCollapsed(ids: string[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ORGCHART_COLLAPSED_KEY, JSON.stringify(ids));
}
