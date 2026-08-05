/**
 * Structured coding-root git tools (#443).
 * Local cycle: status / diff / branch / checkout / add / commit / push.
 * No force-push. Push uses HTTPS allowlist when the terminal sandbox is on.
 */
import { resolveCodingRoot, resolveRepoPath, type FsRootOpts } from "./fs-tools.js";
import {
  runSandboxedArgv,
  runSandboxedArgvSync,
} from "./sandboxed-process.js";
import {
  codingTerminalEgressHosts,
  codingTerminalNetPolicy,
  requiresTerminalSandbox,
} from "./terminal-sandbox.js";
import { startTerminalEgressProxy } from "./terminal-egress-proxy.js";
import { assertCodingKillSwitch } from "./coding-quota.js";

const DIFF_CAP = 24_000;
const LOG_CAP = 4_000;

export type GitToolOpts = FsRootOpts;

function gitEnv(): NodeJS.ProcessEnv {
  return {
    GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || "GodMode",
    GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || "godmode@localhost",
    GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || "GodMode",
    GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || "godmode@localhost",
  };
}

function runGit(
  codingRoot: string,
  args: string[],
  opts?: { allowFail?: boolean; net?: "none" | "allowlist" | "shared" }
): { status: number | null; stdout: string; stderr: string } {
  const res = runSandboxedArgvSync({
    codingRoot,
    cwd: codingRoot,
    argv: ["git", ...args],
    net: opts?.net ?? "none",
    timeoutMs: 60_000,
    envExtra: gitEnv(),
  });
  if (!opts?.allowFail && (res.timedOut || (res.exitCode ?? 1) !== 0)) {
    throw new Error(
      res.timedOut
        ? `git ${args.join(" ")} timed out`
        : `git ${args.join(" ")} failed: ${(res.stderr || res.stdout).trim() || "unknown"}`
    );
  }
  return { status: res.exitCode, stdout: res.stdout, stderr: res.stderr };
}

function assertSafeRef(value: string, label: string): string {
  const v = value.trim();
  if (!v) throw new Error(`${label} required`);
  if (v.startsWith("-") || v.includes("..") || /[\0\n\r]/.test(v)) {
    throw new Error(`invalid ${label}`);
  }
  return v;
}

function assertSafeRemote(value: string): string {
  return assertSafeRef(value, "remote");
}

function cap(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated]`;
}

export function gitStatus(opts: GitToolOpts): {
  branch: string;
  dirtyCount: number;
  ahead: number;
  behind: number;
  porcelain: string;
  branches: string[];
  remotes: string[];
  summary: string;
} {
  const codingRoot = resolveCodingRoot(opts);
  assertCodingKillSwitch(opts.tenantId ?? undefined);
  const inside = runGit(codingRoot, ["rev-parse", "--is-inside-work-tree"], {
    allowFail: true,
  });
  if (inside.stdout.trim() !== "true") {
    throw new Error("Coding root is not a git work tree");
  }
  const branch =
    runGit(codingRoot, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim() ||
    "DETACHED";
  const porcelain = runGit(codingRoot, ["status", "--porcelain"]).stdout;
  const dirtyCount = porcelain
    .split(/\r?\n/)
    .filter((line) => line.length > 0).length;
  let ahead = 0;
  let behind = 0;
  const ab = runGit(
    codingRoot,
    ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"],
    { allowFail: true }
  );
  if ((ab.status ?? 1) === 0 && ab.stdout.trim()) {
    const [left, right] = ab.stdout.trim().split(/\s+/).map((n) => Number(n) || 0);
    behind = left ?? 0;
    ahead = right ?? 0;
  }
  const branchList = runGit(codingRoot, ["branch", "--list", "--format=%(refname:short)"])
    .stdout.split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const remotes = runGit(codingRoot, ["remote"], { allowFail: true })
    .stdout.split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const parts = [`Branch: ${branch}`];
  parts.push(
    dirtyCount === 0 ? "clean" : `dirty: ${dirtyCount} file${dirtyCount === 1 ? "" : "s"}`
  );
  if (ahead > 0 || behind > 0) parts.push(`ahead ${ahead} / behind ${behind}`);
  return {
    branch,
    dirtyCount,
    ahead,
    behind,
    porcelain: cap(porcelain.trim(), LOG_CAP),
    branches: branchList,
    remotes,
    summary: parts.join(" | "),
  };
}

export function gitDiff(
  opts: GitToolOpts & { staged?: boolean; path?: string }
): { diff: string; staged: boolean } {
  const codingRoot = resolveCodingRoot(opts);
  assertCodingKillSwitch(opts.tenantId ?? undefined);
  const args = ["diff", "--no-color"];
  if (opts.staged) args.push("--cached");
  if (opts.path?.trim()) {
    const rel = assertSafeRef(opts.path, "path");
    resolveRepoPath(rel, opts);
    args.push("--", rel);
  }
  const res = runGit(codingRoot, args, { allowFail: true });
  const diff = (res.stdout || res.stderr).trim() || "(no diff)";
  return { diff: cap(diff, DIFF_CAP), staged: Boolean(opts.staged) };
}

export function gitCreateBranch(
  opts: GitToolOpts & { name: string; checkout?: boolean }
): { branch: string; checkedOut: boolean } {
  const codingRoot = resolveCodingRoot(opts);
  assertCodingKillSwitch(opts.tenantId ?? undefined);
  const name = assertSafeRef(opts.name, "branch");
  const checkout = opts.checkout !== false;
  if (checkout) runGit(codingRoot, ["checkout", "-b", name]);
  else runGit(codingRoot, ["branch", name]);
  return { branch: name, checkedOut: checkout };
}

export function gitCheckout(opts: GitToolOpts & { ref: string }): {
  branch: string;
} {
  const codingRoot = resolveCodingRoot(opts);
  assertCodingKillSwitch(opts.tenantId ?? undefined);
  const ref = assertSafeRef(opts.ref, "ref");
  runGit(codingRoot, ["checkout", ref]);
  const branch =
    runGit(codingRoot, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim() || ref;
  return { branch };
}

export function gitAdd(opts: GitToolOpts & { paths: string[] }): {
  paths: string[];
  staged: string;
} {
  const codingRoot = resolveCodingRoot(opts);
  assertCodingKillSwitch(opts.tenantId ?? undefined);
  const paths = (opts.paths ?? []).map((p) => assertSafeRef(String(p), "path"));
  if (!paths.length) throw new Error("paths required");
  for (const rel of paths) resolveRepoPath(rel === "." ? "." : rel, opts);
  runGit(codingRoot, ["add", "--", ...paths]);
  const staged = runGit(codingRoot, ["diff", "--cached", "--stat"], {
    allowFail: true,
  }).stdout.trim();
  return { paths, staged: cap(staged || "(nothing staged)", LOG_CAP) };
}

export function gitCommit(opts: GitToolOpts & { message: string; paths?: string[] }): {
  commit: string;
  message: string;
  stat: string;
} {
  const codingRoot = resolveCodingRoot(opts);
  assertCodingKillSwitch(opts.tenantId ?? undefined);
  const message = String(opts.message ?? "").trim();
  if (!message) throw new Error("commit message required");
  if (opts.paths?.length) {
    gitAdd({ ...opts, paths: opts.paths });
  }
  const staged = runGit(codingRoot, ["diff", "--cached", "--name-only"], {
    allowFail: true,
  }).stdout.trim();
  if (!staged) throw new Error("nothing staged to commit; call git_add first");
  runGit(codingRoot, ["commit", "-m", message]);
  const commit = runGit(codingRoot, ["rev-parse", "--short", "HEAD"]).stdout.trim();
  const stat = runGit(codingRoot, ["show", "--stat", "--oneline", "-1"], {
    allowFail: true,
  }).stdout.trim();
  return { commit, message, stat: cap(stat, LOG_CAP) };
}

export function previewGitToolDiff(
  toolName: string,
  args: Record<string, unknown>,
  opts?: GitToolOpts
): { previewDiff?: string; previewError?: string } {
  try {
    if (toolName === "git_commit") {
      const diff = gitDiff({ ...opts, staged: true });
      return { previewDiff: diff.diff };
    }
    if (toolName === "git_push") {
      const codingRoot = resolveCodingRoot(opts ?? {});
      assertCodingKillSwitch(opts?.tenantId ?? undefined);
      const status = gitStatus(opts ?? {});
      const remote = String(args.remote ?? "origin").trim() || "origin";
      const branch = String(args.branch ?? status.branch).trim() || status.branch;
      const log = runGit(
        codingRoot,
        ["log", "--oneline", `@{upstream}..HEAD`],
        { allowFail: true }
      ).stdout.trim();
      const remoteUrl = runGit(codingRoot, ["remote", "get-url", remote], {
        allowFail: true,
      }).stdout.trim();
      const lines = [
        `Push ${branch} → ${remote}${remoteUrl ? ` (${remoteUrl})` : ""}`,
        `ahead ${status.ahead} / behind ${status.behind}`,
        log ? cap(log, LOG_CAP) : "(no upstream commits to list; first push or no upstream)",
      ];
      return { previewDiff: lines.join("\n") };
    }
    if (toolName === "git_checkout" || toolName === "git_branch") {
      const status = gitStatus(opts ?? {});
      return {
        previewDiff: `Current branch: ${status.branch}\nDirty files: ${status.dirtyCount}`,
      };
    }
    if (toolName === "git_add") {
      const diff = gitDiff({ ...opts, staged: false });
      return { previewDiff: diff.diff };
    }
    return {};
  } catch (err) {
    return { previewError: err instanceof Error ? err.message : String(err) };
  }
}

export async function gitPush(
  opts: GitToolOpts & { remote?: string; branch?: string; force?: unknown }
): Promise<{
  remote: string;
  branch: string;
  output: string;
  ok: boolean;
}> {
  const codingRoot = resolveCodingRoot(opts);
  assertCodingKillSwitch(opts.tenantId ?? undefined);
  if (opts.force === true || opts.force === "true" || opts.force === 1) {
    throw new Error("force-push is not allowed");
  }
  const status = gitStatus(opts);
  const remote = assertSafeRemote(String(opts.remote ?? "origin"));
  const branch = assertSafeRef(String(opts.branch ?? status.branch), "branch");
  if (!status.remotes.includes(remote)) {
    throw new Error(
      `Remote "${remote}" is not configured. Set an HTTPS remote locally, or connect a git host connector for clone/auth/PR flows.`
    );
  }

  const sandboxed = requiresTerminalSandbox();
  const netMode = sandboxed ? codingTerminalNetPolicy() : "none";
  let proxy: Awaited<ReturnType<typeof startTerminalEgressProxy>> | null = null;
  if (sandboxed && netMode === "allowlist") {
    proxy = await startTerminalEgressProxy({
      codingRoot,
      allowlist: codingTerminalEgressHosts(),
    });
  }

  try {
    const res = await runSandboxedArgv({
      codingRoot,
      cwd: codingRoot,
      argv: ["git", "push", remote, branch],
      net: sandboxed ? netMode : "none",
      timeoutMs: 120_000,
      envExtra: gitEnv(),
      proxyUrl: proxy?.jailProxyUrl,
      jailSocketPath: proxy?.jailSocketPath,
      hostEgressDir: proxy?.hostEgressDir,
    });
    const output = cap((res.stdout + res.stderr).trim(), LOG_CAP);
    if (res.timedOut || (res.exitCode ?? 1) !== 0) {
      throw new Error(
        res.timedOut
          ? "git push timed out"
          : `git push failed: ${output || "unknown"}. Use an HTTPS remote with credentials already on this host, or a git host connector.`
      );
    }
    return { remote, branch, output, ok: true };
  } finally {
    await proxy?.close().catch(() => undefined);
  }
}
