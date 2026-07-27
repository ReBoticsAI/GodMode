/**
 * Layer 2 tenant git worktrees (#112).
 * Worktrees live under `{codingRoot}/.worktrees/<slug>` and must stay inside the tenant/local root.
 */
import fs from "node:fs";
import path from "node:path";
import {
  assertWithinCodingRoot,
  resolveCodingRoot,
  type FsRootOpts,
} from "./fs-tools.js";
import { runSandboxedArgvSync } from "./sandboxed-process.js";

const WORKTREES_DIR = ".worktrees";

export type TenantWorktreeOpts = FsRootOpts & {
  tenantId?: string | null;
};

function git(
  codingRoot: string,
  cwd: string,
  args: string[],
  opts?: { allowFail?: boolean }
): { status: number | null; stdout: string; stderr: string } {
  const res = runSandboxedArgvSync({
    codingRoot,
    cwd,
    argv: ["git", ...args],
    net: "none",
    timeoutMs: 60_000,
    envExtra: {
      GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || "GodMode",
      GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || "godmode@localhost",
      GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || "GodMode",
      GIT_COMMITTER_EMAIL:
        process.env.GIT_COMMITTER_EMAIL || "godmode@localhost",
    },
  });
  const stdout = res.stdout;
  const stderr = res.stderr;
  if (!opts?.allowFail && (res.timedOut || (res.exitCode ?? 1) !== 0)) {
    throw new Error(
      res.timedOut
        ? `git ${args.join(" ")} timed out`
        : `git ${args.join(" ")} failed: ${(stderr || stdout).trim() || "unknown"}`
    );
  }
  return { status: res.exitCode, stdout, stderr };
}

function tenantBase(opts?: TenantWorktreeOpts): string {
  return resolveCodingRoot({ ...opts, root: undefined });
}

function sanitizeSlug(raw: string): string {
  const slug = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (!slug) throw new Error("worktree slug required");
  return slug;
}

/** Ensure the coding root is a git repo with at least one commit (needed for worktree add). */
export function ensureTenantGitRepo(opts?: TenantWorktreeOpts): string {
  const root = tenantBase(opts);
  fs.mkdirSync(root, { recursive: true });
  const gitDir = path.join(root, ".git");
  if (!fs.existsSync(gitDir)) {
    git(root, root, ["init"]);
    const marker = path.join(root, ".godmode-workspace");
    if (!fs.existsSync(marker)) {
      fs.writeFileSync(marker, "tenant coding workspace\n", "utf8");
    }
    git(root, root, ["add", "-A"]);
    git(root, root, ["commit", "-m", "init tenant coding workspace"], {
      allowFail: true,
    });
    // If commit failed (nothing to commit), force empty commit
    const head = git(root, root, ["rev-parse", "HEAD"], { allowFail: true });
    if (head.status !== 0) {
      git(root, root, [
        "commit",
        "--allow-empty",
        "-m",
        "init tenant coding workspace",
      ]);
    }
  } else {
    const head = git(root, root, ["rev-parse", "HEAD"], { allowFail: true });
    if (head.status !== 0) {
      git(root, root, [
        "commit",
        "--allow-empty",
        "-m",
        "init tenant coding workspace",
      ]);
    }
  }
  return root;
}

export function worktreeRelativePath(slug: string): string {
  return `${WORKTREES_DIR}/${sanitizeSlug(slug)}`.replace(/\\/g, "/");
}

export function createTenantWorktree(opts: {
  slug: string;
  tenantId?: string | null;
  isolatedDeployment?: boolean;
  tenantWorkspacesDir?: string;
}): {
  slug: string;
  workspace: string;
  absolutePath: string;
  branch: string;
} {
  const slug = sanitizeSlug(opts.slug);
  const root = ensureTenantGitRepo(opts);
  const rel = worktreeRelativePath(slug);
  const abs = assertWithinCodingRoot(rel, { ...opts, root: undefined });
  if (fs.existsSync(abs)) {
    throw new Error(`Worktree already exists: ${rel}`);
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const branch = `wt/${slug}`;
  // Prefer new branch from HEAD; if branch exists, attach worktree to it.
  const addNew = git(root, root, ["worktree", "add", "-b", branch, abs], {
    allowFail: true,
  });
  if (addNew.status !== 0) {
    git(root, root, ["worktree", "add", abs, branch]);
  }
  return { slug, workspace: rel, absolutePath: abs, branch };
}

export function listTenantWorktrees(opts?: TenantWorktreeOpts): Array<{
  workspace: string;
  absolutePath: string;
  branch?: string;
}> {
  const root = tenantBase(opts);
  const baseDir = path.join(root, WORKTREES_DIR);
  if (!fs.existsSync(baseDir)) return [];
  const out: Array<{ workspace: string; absolutePath: string; branch?: string }> =
    [];
  for (const name of fs.readdirSync(baseDir)) {
    const abs = path.join(baseDir, name);
    if (!fs.statSync(abs).isDirectory()) continue;
    const rel = worktreeRelativePath(name);
    assertWithinCodingRoot(rel, { ...opts, root: undefined });
    const branch = git(root, abs, ["rev-parse", "--abbrev-ref", "HEAD"], {
      allowFail: true,
    });
    out.push({
      workspace: rel,
      absolutePath: abs,
      branch: branch.status === 0 ? branch.stdout.trim() : undefined,
    });
  }
  return out.sort((a, b) => a.workspace.localeCompare(b.workspace));
}

export function discardTenantWorktree(opts: {
  slugOrWorkspace: string;
  tenantId?: string | null;
  isolatedDeployment?: boolean;
  tenantWorkspacesDir?: string;
}): { discarded: string; absolutePath: string } {
  const raw = String(opts.slugOrWorkspace ?? "").trim().replace(/\\/g, "/");
  if (!raw) throw new Error("slug or workspace path required");
  const rel = raw.includes("/")
    ? raw.replace(/^\.\//, "")
    : worktreeRelativePath(raw);
  if (!rel.startsWith(`${WORKTREES_DIR}/`)) {
    throw new Error(`Not a managed worktree path: ${rel}`);
  }
  const root = tenantBase(opts);
  const abs = assertWithinCodingRoot(rel, { ...opts, root: undefined });
  if (!fs.existsSync(abs)) {
    throw new Error(`Worktree not found: ${rel}`);
  }
  git(root, root, ["worktree", "remove", "--force", abs], { allowFail: true });
  if (fs.existsSync(abs)) {
    fs.rmSync(abs, { recursive: true, force: true });
    git(root, root, ["worktree", "prune"], { allowFail: true });
  } else {
    git(root, root, ["worktree", "prune"], { allowFail: true });
  }
  return { discarded: rel, absolutePath: abs };
}

function resolveWorktreeRel(slugOrWorkspace: string): string {
  const raw = String(slugOrWorkspace ?? "").trim().replace(/\\/g, "/");
  if (!raw) throw new Error("slug or workspace path required");
  const rel = raw.includes("/")
    ? raw.replace(/^\.\//, "")
    : worktreeRelativePath(raw);
  if (!rel.startsWith(`${WORKTREES_DIR}/`)) {
    throw new Error(`Not a managed worktree path: ${rel}`);
  }
  return rel;
}

function listPluginIdsUnder(root: string): string[] {
  const pluginsDir = path.join(root, "plugins");
  if (!fs.existsSync(pluginsDir)) return [];
  return fs
    .readdirSync(pluginsDir)
    .filter((name) => {
      const abs = path.join(pluginsDir, name);
      return (
        fs.statSync(abs).isDirectory() &&
        fs.existsSync(path.join(abs, "godmode.plugin.json"))
      );
    })
    .sort();
}

/**
 * Commit dirty WIP in the worktree (if any), merge `wt/<slug>` into the tenant
 * main worktree, and return plugin ids present under live `plugins/` after merge.
 */
export function promoteTenantWorktree(opts: {
  slugOrWorkspace: string;
  tenantId?: string | null;
  isolatedDeployment?: boolean;
  tenantWorkspacesDir?: string;
}): {
  workspace: string;
  branch: string;
  merged: true;
  pluginIds: string[];
  committed: boolean;
} {
  const rel = resolveWorktreeRel(opts.slugOrWorkspace);
  const root = tenantBase(opts);
  const abs = assertWithinCodingRoot(rel, { ...opts, root: undefined });
  if (!fs.existsSync(abs)) {
    throw new Error(`Worktree not found: ${rel}`);
  }

  const branchRes = git(root, abs, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = branchRes.stdout.trim() || `wt/${path.basename(rel)}`;

  const status = git(root, abs, ["status", "--porcelain"]);
  let committed = false;
  if (status.stdout.trim()) {
    git(root, abs, ["add", "-A"]);
    git(root, abs, ["commit", "-m", `wip: promote ${rel}`]);
    committed = true;
  }

  const beforeMerge = git(root, root, ["rev-parse", "HEAD"]).stdout.trim();
  const merge = git(
    root,
    root,
    ["merge", branch, "--no-ff", "-m", `promote worktree ${path.basename(rel)}`],
    { allowFail: true }
  );
  if (merge.status !== 0) {
    git(root, root, ["merge", "--abort"], { allowFail: true });
    throw new Error(
      `Promote merge failed (conflicts or git error). Resolve in the tenant root or discard the worktree.\n${(
        merge.stderr || merge.stdout
      ).trim()}`
    );
  }

  // Plugin ids touched by the merge range, falling back to all live plugins.
  const diff = git(
    root,
    root,
    ["diff", "--name-only", `${beforeMerge}..HEAD`, "--", "plugins"],
    { allowFail: true }
  );
  const fromDiff = new Set<string>();
  for (const line of diff.stdout.split(/\r?\n/)) {
    const m = line.replace(/\\/g, "/").match(/^plugins\/([^/]+)\//);
    if (m?.[1]) fromDiff.add(m[1]);
  }
  const liveIds = listPluginIdsUnder(root);
  const pluginIds =
    fromDiff.size > 0
      ? liveIds.filter((id) => fromDiff.has(id))
      : liveIds;

  return {
    workspace: rel,
    branch,
    merged: true,
    pluginIds,
    committed,
  };
}

