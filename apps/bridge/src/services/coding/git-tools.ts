/**
 * Structured coding-root git tools (#443 / #442).
 * Local cycle: status / diff / branch / checkout / add / commit / push.
 * No force-push. Push uses HTTPS allowlist when the terminal sandbox is on.
 * github.com HTTPS remotes can authenticate via Vault GitHub Connect.
 */
import fs from "node:fs";
import path from "node:path";
import {
  resolveCodingRoot,
  resolveRepoPath,
  resolveUnderBase,
  type FsRootOpts,
} from "./fs-tools.js";
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
import {
  githubHttpsAuthGitEnv,
  parseGithubHttpsRemote,
  redactRemoteUrl,
} from "./git-host-auth.js";

const DIFF_CAP = 24_000;
const LOG_CAP = 4_000;

/** Cursor Cloud/SDK injects these even when IDE Attribution toggles are off. */
const CURSOR_ATTRIBUTION_LINE =
  /^(Co-authored-by:\s*Cursor\s*<[^>\n]*cursor\.com>|Made-with:\s*Cursor|Made with Cursor)\s*$/gim;

/**
 * Strip Cursor marketing attribution from commit messages before `git commit`.
 * IDE Attribution OFF does not apply to Cloud Agents / SDK; strip locally instead.
 */
export function stripCursorCommitAttribution(message: string): string {
  const cleaned = String(message ?? "")
    .replace(CURSOR_ATTRIBUTION_LINE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned;
}

export type GitToolOpts = FsRootOpts;

/**
 * Network for sandboxed git clone/push/fetch (#442).
 * Interactive terminals may use CODING_TERMINAL_NET=none; git host ops still
 * need allowlisted CONNECT egress or clones fail with "Could not resolve host".
 */
export function resolveSandboxedGitNetMode(opts: {
  sandboxed: boolean;
  terminalNet: "none" | "shared" | "allowlist";
}): "none" | "shared" | "allowlist" {
  if (!opts.sandboxed) return "none";
  if (opts.terminalNet === "none") return "allowlist";
  return opts.terminalNet;
}

export function sandboxedGitNetMode(): "none" | "shared" | "allowlist" {
  return resolveSandboxedGitNetMode({
    sandboxed: requiresTerminalSandbox(),
    terminalNet: codingTerminalNetPolicy(),
  });
}

/** Force libcurl/git to use the jail CONNECT proxy (env alone is unreliable). */
function gitArgvWithProxy(
  gitArgs: string[],
  proxyUrl: string | null | undefined
): string[] {
  const url = String(proxyUrl ?? "").trim();
  if (!url) return ["git", ...gitArgs];
  return [
    "git",
    "-c",
    `http.proxy=${url}`,
    "-c",
    `https.proxy=${url}`,
    ...gitArgs,
  ];
}

function gitEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || "GodMode",
    GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || "godmode@localhost",
    GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || "GodMode",
    GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || "godmode@localhost",
    ...(extra ?? {}),
  };
}

function remoteGetUrl(codingRoot: string, remote: string): string {
  return runGit(codingRoot, ["remote", "get-url", remote], {
    allowFail: true,
  }).stdout.trim();
}

/** Read a remote URL without credentials (for PR owner/repo resolution). */
export function gitRemoteHttpsUrl(
  opts: GitToolOpts & { remote?: string }
): string {
  const codingRoot = resolveCodingRoot(opts);
  assertCodingKillSwitch(opts.tenantId ?? undefined);
  const remote = assertSafeRemote(String(opts.remote ?? "origin"));
  const url = remoteGetUrl(codingRoot, remote);
  if (!url) {
    throw new Error(
      `Remote "${remote}" is not configured. Set an HTTPS remote, or connect GitHub in Vault → Integrations.`
    );
  }
  return redactRemoteUrl(url);
}

/**
 * Point a remote at a github.com HTTPS URL (add or set-url). Used after
 * github_repo_create so git_push can publish the new repo.
 */
export function setGithubHttpsRemote(
  opts: GitToolOpts & { url: string; remote?: string }
): { remote: string; url: string; action: "added" | "updated" } {
  const codingRoot = resolveCodingRoot(opts);
  assertCodingKillSwitch(opts.tenantId ?? undefined);
  const parsed = parseGithubHttpsRemote(String(opts.url ?? ""));
  if (!parsed) {
    throw new Error("Remote must be an https://github.com/owner/repo URL");
  }
  const remote = assertSafeRemote(String(opts.remote ?? "origin"));
  const existing = remoteGetUrl(codingRoot, remote);
  if (existing) {
    runGit(codingRoot, ["remote", "set-url", remote, parsed.httpsUrl]);
    return { remote, url: parsed.httpsUrl, action: "updated" };
  }
  runGit(codingRoot, ["remote", "add", remote, parsed.httpsUrl]);
  return { remote, url: parsed.httpsUrl, action: "added" };
}

/**
 * Resolve a relative coding workspace under the tenant/local coding base
 * (ignores the current agent workspace override). Path must exist and be a
 * git work tree. Returns the relative path to store on agent.config.workspace.
 */
export function resolveRelativeCodingWorkspace(
  opts: GitToolOpts & { workspace: string }
): { absolute: string; relative: string; base: string } {
  assertCodingKillSwitch(opts.tenantId ?? undefined);
  const base = resolveCodingRoot({ ...opts, root: undefined });
  const raw = String(opts.workspace ?? "")
    .trim()
    .replace(/\\/g, "/");
  if (!raw || raw === ".") {
    throw new Error(
      "workspace must be a relative subfolder under the coding root (use coding_workspace_clear for the base root)"
    );
  }
  if (path.isAbsolute(raw) || raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) {
    throw new Error("workspace must be a relative path under the coding root");
  }
  const absolute = resolveUnderBase(base, raw);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) {
    throw new Error(`Workspace path does not exist: ${raw}`);
  }
  const inside = runGit(absolute, ["rev-parse", "--is-inside-work-tree"], {
    allowFail: true,
  });
  if (inside.stdout.trim() !== "true") {
    throw new Error(
      `Workspace path is not a git work tree: ${raw}. Clone or init a repo there first.`
    );
  }
  const relative = path.relative(base, absolute).replace(/\\/g, "/");
  if (!relative || relative.startsWith("..")) {
    throw new Error(`Path escapes coding root: ${raw}`);
  }
  return { absolute, relative, base };
}

async function withGitNetwork<T>(
  codingRoot: string,
  run: (proxy: {
    jailProxyUrl?: string;
    jailSocketPath?: string;
    hostEgressDir?: string;
  } | null) => Promise<T>
): Promise<T> {
  const sandboxed = requiresTerminalSandbox();
  const netMode = sandboxed ? sandboxedGitNetMode() : "none";
  let proxy: Awaited<ReturnType<typeof startTerminalEgressProxy>> | null = null;
  if (sandboxed && netMode === "allowlist") {
    proxy = await startTerminalEgressProxy({
      codingRoot,
      allowlist: codingTerminalEgressHosts(),
    });
  }
  try {
    return await run(
      proxy
        ? {
            jailProxyUrl: proxy.jailProxyUrl,
            jailSocketPath: proxy.jailSocketPath,
            hostEgressDir: proxy.hostEgressDir,
          }
        : null
    );
  } finally {
    await proxy?.close().catch(() => undefined);
  }
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
  const message = stripCursorCommitAttribution(String(opts.message ?? ""));
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
      const remoteUrl = redactRemoteUrl(remoteGetUrl(codingRoot, remote));
      const gh = parseGithubHttpsRemote(remoteUrl);
      const lines = [
        `Push ${branch} → ${remote}${remoteUrl ? ` (${remoteUrl})` : ""}`,
        `ahead ${status.ahead} / behind ${status.behind}`,
        gh
          ? "Auth: Vault GitHub Connect when connected; otherwise host HTTPS credentials"
          : "Auth: host HTTPS credentials (non-GitHub remote)",
        log ? cap(log, LOG_CAP) : "(no upstream commits to list; first push or no upstream)",
      ];
      return { previewDiff: lines.join("\n") };
    }
    if (toolName === "git_clone") {
      const url = redactRemoteUrl(String(args.url ?? ""));
      const directory = String(args.directory ?? "").trim() || "(repo name)";
      const gh = parseGithubHttpsRemote(url);
      if (!gh) {
        return {
          previewError:
            "git_clone only supports https://github.com/owner/repo URLs",
        };
      }
      return {
        previewDiff: `Clone ${gh.httpsUrl} → ${directory}\nAuth: Vault GitHub Connect`,
      };
    }
    if (toolName === "github_repo_create") {
      const name = String(args.name ?? "").trim() || "(name required)";
      const owner = String(args.owner ?? "").trim() || "(connected GitHub user)";
      const description = String(args.description ?? "").trim();
      return {
        previewDiff: [
          `Create public GitHub repository: ${owner}/${name}`,
          description ? `Description: ${description}` : "Description: (none)",
          "Visibility: public",
          "Does not delete repositories",
          "Auth: Vault GitHub Connect (Personal Vault)",
          args.setRemote === false
            ? "Will not change git remotes"
            : "Will set origin to the new clone URL",
        ].join("\n"),
      };
    }
    if (toolName === "github_pr_create") {
      const status = gitStatus(opts ?? {});
      const title = String(args.title ?? "").trim() || "(untitled)";
      const base = String(args.base ?? "main").trim() || "main";
      const head = String(args.head ?? status.branch).trim() || status.branch;
      const remote = String(args.remote ?? "origin").trim() || "origin";
      const remoteUrl = redactRemoteUrl(
        remoteGetUrl(resolveCodingRoot(opts ?? {}), remote)
      );
      return {
        previewDiff: [
          `Open PR: ${head} → ${base}`,
          `Title: ${title}`,
          `Remote: ${remote}${remoteUrl ? ` (${remoteUrl})` : ""}`,
          args.draft === true ? "Draft: yes" : "Draft: no",
          "Auth: Vault GitHub Connect",
        ].join("\n"),
      };
    }
    if (
      toolName === "github_release_create" ||
      toolName === "github_release_publish"
    ) {
      const remote = String(args.remote ?? "origin").trim() || "origin";
      const remoteUrl = redactRemoteUrl(
        remoteGetUrl(resolveCodingRoot(opts ?? {}), remote)
      );
      if (toolName === "github_release_publish") {
        return {
          previewDiff: [
            `Publish draft release id=${String(args.releaseId ?? "")}`,
            `Remote: ${remote}${remoteUrl ? ` (${remoteUrl})` : ""}`,
            "Auth: Vault GitHub Connect",
            "Authority: Deploy kill switch applies",
          ].join("\n"),
        };
      }
      return {
        previewDiff: [
          `Create GitHub release ${String(args.tag ?? "(tag)")}`,
          `Name: ${String(args.name ?? args.tag ?? "")}`,
          args.draft === false ? "Draft: no (publish)" : "Draft: yes (default)",
          `Remote: ${remote}${remoteUrl ? ` (${remoteUrl})` : ""}`,
          "Auth: Vault GitHub Connect",
          "Authority: Deploy kill switch applies",
        ].join("\n"),
      };
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
  opts: GitToolOpts & {
    remote?: string;
    branch?: string;
    force?: unknown;
    /** Vault GitHub Connect token for github.com HTTPS remotes (#442). */
    githubAccessToken?: string | null;
    /** @deprecated use githubAccessToken */
    accessToken?: string | null;
  }
): Promise<{
  remote: string;
  branch: string;
  output: string;
  ok: boolean;
  usedConnectAuth: boolean;
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
      `Remote "${remote}" is not configured. Set an HTTPS remote locally, or connect GitHub in Vault → Integrations for clone/auth/PR flows.`
    );
  }

  const remoteUrl = remoteGetUrl(codingRoot, remote);
  const token = String(
    opts.githubAccessToken ?? opts.accessToken ?? ""
  ).trim();
  const githubRemote = Boolean(parseGithubHttpsRemote(remoteUrl));
  const usedConnectAuth = Boolean(token && githubRemote);
  const authEnv = usedConnectAuth ? githubHttpsAuthGitEnv(token) : undefined;
  const sandboxed = requiresTerminalSandbox();
  const netMode = sandboxed ? sandboxedGitNetMode() : "none";

  return withGitNetwork(codingRoot, async (proxy) => {
    const res = await runSandboxedArgv({
      codingRoot,
      cwd: codingRoot,
      argv: gitArgvWithProxy(["push", remote, branch], proxy?.jailProxyUrl),
      net: sandboxed ? netMode : "none",
      timeoutMs: 120_000,
      envExtra: gitEnv(authEnv),
      proxyUrl: proxy?.jailProxyUrl,
      jailSocketPath: proxy?.jailSocketPath,
      hostEgressDir: proxy?.hostEgressDir,
    });
    const output = cap((res.stdout + res.stderr).trim(), LOG_CAP);
    if (res.timedOut || (res.exitCode ?? 1) !== 0) {
      const hint = githubRemote
        ? " Connect GitHub in Personal Vault → Integrations."
        : " Use an HTTPS remote with a configured git host.";
      throw new Error(
        res.timedOut
          ? "git push timed out"
          : `git push failed: ${output || "unknown"}.${hint}`
      );
    }
    return { remote, branch, output, ok: true, usedConnectAuth };
  });
}

/**
 * Clone a github.com HTTPS repo into a subdirectory of the coding root (#442).
 * Requires Vault GitHub Connect.
 */
export async function gitClone(
  opts: GitToolOpts & {
    url: string;
    directory?: string;
    githubAccessToken?: string;
    /** @deprecated use githubAccessToken */
    accessToken?: string;
  }
): Promise<{
  path: string;
  url: string;
  directory: string;
  usedConnectAuth: true;
}> {
  const codingRoot = resolveCodingRoot(opts);
  assertCodingKillSwitch(opts.tenantId ?? undefined);
  const parsed = parseGithubHttpsRemote(String(opts.url ?? ""));
  if (!parsed) {
    throw new Error(
      "git_clone only supports https://github.com/owner/repo URLs"
    );
  }
  const token = String(
    opts.githubAccessToken ?? opts.accessToken ?? ""
  ).trim();
  if (!token) {
    throw new Error(
      "Connect GitHub in Personal Vault → Integrations before cloning a github.com repo"
    );
  }
  const defaultDir = parsed.repo;
  const directory = assertSafeRef(
    String(opts.directory ?? defaultDir).trim() || defaultDir,
    "directory"
  );
  if (directory.includes("/") || directory.includes("\\")) {
    throw new Error(
      "directory must be a single path segment under the coding root"
    );
  }
  const target = resolveRepoPath(directory, opts);
  const sandboxed = requiresTerminalSandbox();
  const netMode = sandboxed ? sandboxedGitNetMode() : "none";
  const authEnv = githubHttpsAuthGitEnv(token);

  return withGitNetwork(codingRoot, async (proxy) => {
    const res = await runSandboxedArgv({
      codingRoot,
      cwd: codingRoot,
      argv: gitArgvWithProxy(
        ["clone", "--", parsed.httpsUrl, directory],
        proxy?.jailProxyUrl
      ),
      net: sandboxed ? netMode : "none",
      timeoutMs: 300_000,
      envExtra: gitEnv(authEnv),
      proxyUrl: proxy?.jailProxyUrl,
      jailSocketPath: proxy?.jailSocketPath,
      hostEgressDir: proxy?.hostEgressDir,
    });
    const output = cap((res.stdout + res.stderr).trim(), LOG_CAP);
    if (res.timedOut || (res.exitCode ?? 1) !== 0) {
      throw new Error(
        res.timedOut
          ? "git clone timed out"
          : `git clone failed: ${output || "unknown"}. Connect GitHub in Personal Vault → Integrations and retry.`
      );
    }
    return {
      path: target,
      url: parsed.httpsUrl,
      directory,
      usedConnectAuth: true as const,
    };
  });
}
