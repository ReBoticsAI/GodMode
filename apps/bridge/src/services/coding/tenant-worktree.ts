/**
 * Layer 2 tenant git worktrees (#112).
 * Worktrees live under `{codingRoot}/.worktrees/<slug>` and must stay inside the tenant/local root.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  assertWithinCodingRoot,
  resolveCodingRoot,
  type FsRootOpts,
} from "./fs-tools.js";

const WORKTREES_DIR = ".worktrees";

export type TenantWorktreeOpts = FsRootOpts & {
  tenantId?: string | null;
};

function git(
  cwd: string,
  args: string[],
  opts?: { allowFail?: boolean }
): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || "GodMode",
      GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || "godmode@localhost",
      GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || "GodMode",
      GIT_COMMITTER_EMAIL:
        process.env.GIT_COMMITTER_EMAIL || "godmode@localhost",
    },
  });
  const stdout = String(res.stdout ?? "");
  const stderr = String(res.stderr ?? "");
  if (!opts?.allowFail && (res.error || (res.status ?? 1) !== 0)) {
    throw new Error(
      res.error?.message ??
        `git ${args.join(" ")} failed: ${(stderr || stdout).trim() || "unknown"}`
    );
  }
  return { status: res.status, stdout, stderr };
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
    git(root, ["init"]);
    const marker = path.join(root, ".godmode-workspace");
    if (!fs.existsSync(marker)) {
      fs.writeFileSync(marker, "tenant coding workspace\n", "utf8");
    }
    git(root, ["add", "-A"]);
    git(root, ["commit", "-m", "init tenant coding workspace"], {
      allowFail: true,
    });
    // If commit failed (nothing to commit), force empty commit
    const head = git(root, ["rev-parse", "HEAD"], { allowFail: true });
    if (head.status !== 0) {
      git(root, ["commit", "--allow-empty", "-m", "init tenant coding workspace"]);
    }
  } else {
    const head = git(root, ["rev-parse", "HEAD"], { allowFail: true });
    if (head.status !== 0) {
      git(root, ["commit", "--allow-empty", "-m", "init tenant coding workspace"]);
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
  const addNew = git(
    root,
    ["worktree", "add", "-b", branch, abs],
    { allowFail: true }
  );
  if (addNew.status !== 0) {
    git(root, ["worktree", "add", abs, branch]);
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
    const branch = git(abs, ["rev-parse", "--abbrev-ref", "HEAD"], {
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
  git(root, ["worktree", "remove", "--force", abs], { allowFail: true });
  if (fs.existsSync(abs)) {
    fs.rmSync(abs, { recursive: true, force: true });
    git(root, ["worktree", "prune"], { allowFail: true });
  } else {
    git(root, ["worktree", "prune"], { allowFail: true });
  }
  return { discarded: rel, absolutePath: abs };
}
