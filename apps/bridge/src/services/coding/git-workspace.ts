import { execFileSync } from "node:child_process";
import type {
  GitWorkspaceSnapshot,
  PlatformContext,
} from "../../types/platform-context.js";
import { resolveCodingRoot, type FsRootOpts } from "./fs-tools.js";

export type { GitWorkspaceSnapshot };

const GIT_TIMEOUT_MS = 2_000;
const SUMMARY_CAP = 500;

function runGit(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim();
  } catch {
    return null;
  }
}

function truncateSummary(summary: string): string {
  if (summary.length <= SUMMARY_CAP) return summary;
  return `${summary.slice(0, SUMMARY_CAP - 1)}…`;
}

/**
 * Compact git status for the coding root (Cursor-like workspace context).
 * Soft-fails outside a work tree or when git is unavailable.
 */
export function collectGitWorkspaceSnapshot(
  cwd: string
): GitWorkspaceSnapshot | null {
  if (!cwd?.trim()) return null;
  const inside = runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (inside !== "true") return null;

  const branch =
    runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]) || "DETACHED";
  const porcelain = runGit(cwd, ["status", "--porcelain"]) ?? "";
  const dirtyCount = porcelain
    ? porcelain.split(/\r?\n/).filter((line) => line.length > 0).length
    : 0;

  let ahead = 0;
  let behind = 0;
  const ab = runGit(cwd, [
    "rev-list",
    "--left-right",
    "--count",
    "@{upstream}...HEAD",
  ]);
  if (ab) {
    const [left, right] = ab.split(/\s+/).map((n) => Number(n) || 0);
    behind = left ?? 0;
    ahead = right ?? 0;
  }

  const parts = [`Branch: ${branch}`];
  parts.push(
    dirtyCount === 0
      ? "clean"
      : `dirty: ${dirtyCount} file${dirtyCount === 1 ? "" : "s"}`
  );
  if (ahead > 0 || behind > 0) {
    parts.push(`ahead ${ahead} / behind ${behind}`);
  }

  return {
    branch,
    dirtyCount,
    ahead,
    behind,
    summary: truncateSummary(parts.join(" | ")),
  };
}

/** Resolve coding root then attach a git snapshot onto platform context. */
export function enrichPlatformContextWithGit(
  ctx: PlatformContext | undefined,
  opts?: FsRootOpts & { workspace?: string | null }
): PlatformContext | undefined {
  const root = resolveCodingRoot({
    tenantId: opts?.tenantId,
    root: opts?.workspace?.trim() || opts?.root,
  });
  const snap = collectGitWorkspaceSnapshot(root);
  if (!snap) return ctx;
  return { ...(ctx ?? {}), gitSnapshot: snap };
}
