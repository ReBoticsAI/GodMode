import { isCodingWriteTool } from "../ai-tools-registry.js";
import { createNotification } from "../notification-service.js";

export type ExploreHandoff = {
  paths: string[];
  findings: string[];
  openQuestions: string[];
  answer?: string;
};

const EXPLORE_BLOCKED = new Set([
  "run_terminal",
  "terminal_session_create",
  "terminal_session_write",
  "terminal_session_close",
  "scaffold_plugin",
  "build_plugin",
  "install_plugin",
  "run_ephemeral_build",
  "git_branch",
  "git_checkout",
  "git_add",
  "git_commit",
  "git_push",
  "git_clone",
  "github_pr_create",
  "revert_file",
]);

export function exploreToolBlocked(name: string): boolean {
  return isCodingWriteTool(name) || EXPLORE_BLOCKED.has(name);
}

export function parseExploreHandoff(raw: string): ExploreHandoff {
  const text = String(raw ?? "").trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      const paths = Array.isArray(parsed.paths)
        ? parsed.paths.map(String).filter(Boolean)
        : [];
      const findings = Array.isArray(parsed.findings)
        ? parsed.findings.map(String).filter(Boolean)
        : [];
      const openQuestions = Array.isArray(parsed.openQuestions)
        ? parsed.openQuestions.map(String).filter(Boolean)
        : Array.isArray(parsed.open_questions)
          ? parsed.open_questions.map(String).filter(Boolean)
          : [];
      if (paths.length || findings.length || openQuestions.length) {
        return {
          paths,
          findings,
          openQuestions,
          answer: typeof parsed.answer === "string" ? parsed.answer : text,
        };
      }
    } catch {
      /* fall through */
    }
  }
  return {
    paths: [],
    findings: text ? [text.slice(0, 4000)] : [],
    openQuestions: [],
    answer: text || undefined,
  };
}

export function notifyExploreFailure(opts: {
  userId?: string | null;
  tenantId?: string | null;
  agentId: string;
  status: "timeout" | "error";
  detail: string;
}): void {
  if (!opts.userId) return;
  createNotification({
    recipientKind: "user",
    recipientId: opts.userId,
    recipientTenantId: opts.tenantId ?? null,
    category: "coding_explore",
    title:
      opts.status === "timeout"
        ? "Coding explore timed out"
        : "Coding explore failed",
    body: opts.detail.slice(0, 500),
    link: "/coding",
  });
  createNotification({
    recipientKind: "agent",
    recipientId: opts.agentId,
    recipientTenantId: opts.tenantId ?? null,
    category: "coding_explore",
    title:
      opts.status === "timeout"
        ? "Coding explore timed out"
        : "Coding explore failed",
    body: opts.detail.slice(0, 500),
    link: "/coding",
  });
}

export const EXPLORE_SYSTEM_EXTRA = [
  "You are a read-only coding explorer. Do not edit, commit, push, install, or run mutating shell.",
  "Use read_file, grep, glob, list_dir, codebase_search, explore_codebase, git_status, git_diff only.",
  "End with a JSON object: {\"paths\":[...],\"findings\":[...],\"openQuestions\":[...]}",
].join(" ");
