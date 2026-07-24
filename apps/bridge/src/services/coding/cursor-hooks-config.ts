import fs from "node:fs";
import path from "node:path";
import type {
  HooksWorkspaceDiscovery,
  PlatformContext,
} from "../../types/platform-context.js";
import { resolveCodingRoot, type FsRootOpts } from "./fs-tools.js";

export type { HooksWorkspaceDiscovery };

const SUMMARY_CAP = 500;
const MAX_EVENTS = 16;

function truncateSummary(summary: string): string {
  if (summary.length <= SUMMARY_CAP) return summary;
  return `${summary.slice(0, SUMMARY_CAP - 1)}…`;
}

/**
 * Read coding-root `.cursor/hooks.json` for prompt awareness.
 * Soft-fails on missing/invalid JSON. Does not execute hooks.
 */
export function collectCursorHooksDiscovery(
  codingRoot: string
): HooksWorkspaceDiscovery | null {
  if (!codingRoot?.trim()) return null;
  const filePath = path.join(path.resolve(codingRoot), ".cursor", "hooks.json");
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const root = parsed as Record<string, unknown>;
  const hooksRaw = root.hooks;
  const events: string[] = [];
  if (typeof hooksRaw === "object" && hooksRaw !== null && !Array.isArray(hooksRaw)) {
    for (const key of Object.keys(hooksRaw as Record<string, unknown>).sort()) {
      if (key.trim()) events.push(key.trim());
    }
  } else {
    // Some configs list top-level event keys beside version.
    for (const key of Object.keys(root).sort()) {
      if (key === "version" || key === "hooks") continue;
      if (key.trim()) events.push(key.trim());
    }
  }
  if (events.length === 0) return null;

  const listed = events.slice(0, MAX_EVENTS);
  const parts = [`events: ${listed.join(", ")}`];
  if (events.length > listed.length) {
    parts.push(`+${events.length - listed.length} more`);
  }
  parts.push("discovery only (not executed by Bridge)");

  return {
    events,
    sourcePath: filePath,
    summary: truncateSummary(parts.join(" | ")),
  };
}

/** Resolve coding root then attach hooks discovery onto platform context. */
export function enrichPlatformContextWithHooks(
  ctx: PlatformContext | undefined,
  opts?: FsRootOpts & { workspace?: string | null }
): PlatformContext | undefined {
  const root = resolveCodingRoot({
    tenantId: opts?.tenantId,
    root: opts?.workspace?.trim() || opts?.root,
  });
  const discovery = collectCursorHooksDiscovery(root);
  if (!discovery) return ctx;
  return { ...(ctx ?? {}), hooksDiscovery: discovery };
}
