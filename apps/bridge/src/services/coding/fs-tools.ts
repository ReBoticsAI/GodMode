import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { config } from "../../config.js";
import { ensureTenantWorkspaceDir } from "../personal-os-seed.js";

const DEFAULT_READ_LIMIT = 2000;
const MAX_OUTPUT_BYTES = 256 * 1024;

export type FsRootOpts = {
  tenantId?: string | null;
  /** Optional workspace under the tenant/local coding root (agent config.workspace). */
  root?: string;
  /** Force hub/client isolation semantics (tests). */
  isolatedDeployment?: boolean;
  /** Override tenant-workspaces parent directory (tests). */
  tenantWorkspacesDir?: string;
};

function isIsolatedDeployment(opts?: FsRootOpts): boolean {
  return opts?.isolatedDeployment ?? (config.isHub || config.isClient);
}

/** Resolve candidate under base; reject escapes (absolute or ..). */
export function resolveUnderBase(base: string, candidate: string): string {
  const baseAbs = path.resolve(base);
  const trimmed = candidate.replace(/\\/g, "/").trim();
  if (!trimmed) return baseAbs;
  const target = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(baseAbs, trimmed);
  const rel = path.relative(baseAbs, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes coding root: ${candidate}`);
  }
  return target;
}

function tenantWorkspaceRoot(tenantId: string, opts?: FsRootOpts): string {
  const id = tenantId.trim();
  if (!id) throw new Error("tenantId required");
  if (opts?.tenantWorkspacesDir?.trim()) {
    const dir = path.join(path.resolve(opts.tenantWorkspacesDir.trim()), id);
    fs.mkdirSync(dir, { recursive: true });
    return path.resolve(dir);
  }
  return path.resolve(ensureTenantWorkspaceDir(id));
}

/**
 * Coding root for FS/terminal tools.
 * Hub/client: always `{tenantWorkspaces}/<tenantId>/` (optional workspace subpath).
 * Local: `config.repoRoot` or explicit `root` (tests / operator override).
 */
export function resolveCodingRoot(opts?: FsRootOpts): string {
  if (isIsolatedDeployment(opts)) {
    const tenantId = String(opts?.tenantId ?? "").trim();
    if (!tenantId) {
      throw new Error(
        "tenantId required to resolve coding root on hub/client"
      );
    }
    const tenantRoot = tenantWorkspaceRoot(tenantId, opts);
    if (opts?.root?.trim()) {
      return resolveUnderBase(tenantRoot, opts.root.trim());
    }
    return tenantRoot;
  }
  if (opts?.root?.trim()) {
    return path.resolve(opts.root.trim());
  }
  return path.resolve(config.repoRoot);
}

/**
 * Ensure absOrRel is inside the tenant/local coding base (ignores agent workspace override).
 * Returns the resolved absolute path.
 */
export function assertWithinCodingRoot(
  absOrRel: string,
  opts?: FsRootOpts
): string {
  const base = resolveCodingRoot({ ...opts, root: undefined });
  return resolveUnderBase(base, absOrRel);
}

/** Resolve a user path under the coding root; reject escapes. */
export function resolveRepoPath(userPath: string, opts?: FsRootOpts): string {
  const base = path.resolve(resolveCodingRoot(opts));
  return resolveUnderBase(base, userPath.replace(/\\/g, "/"));
}

function budgetText(text: string, maxBytes = MAX_OUTPUT_BYTES): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return text;
  return buf.subarray(0, maxBytes).toString("utf8") + "\n…[truncated]";
}

export function readFile(opts: {
  path: string;
  offset?: number;
  limit?: number;
} & FsRootOpts): { path: string; content: string; totalLines: number; startLine: number } {
  const abs = resolveRepoPath(opts.path, opts);
  if (!fs.existsSync(abs)) throw new Error(`File not found: ${opts.path}`);
  const stat = fs.statSync(abs);
  if (!stat.isFile()) throw new Error(`Not a file: ${opts.path}`);
  const raw = fs.readFileSync(abs, "utf8");
  const lines = raw.split(/\r?\n/);
  const start = Math.max(1, Number(opts.offset ?? 1));
  const limit = Math.max(1, Number(opts.limit ?? DEFAULT_READ_LIMIT));
  const slice = lines.slice(start - 1, start - 1 + limit);
  const numbered = slice
    .map((line, i) => `${String(start + i).padStart(6)}|${line}`)
    .join("\n");
  return {
    path: opts.path,
    content: budgetText(numbered),
    totalLines: lines.length,
    startLine: start,
  };
}

export function readFileRaw(opts: {
  path: string;
} & FsRootOpts): string {
  const abs = resolveRepoPath(opts.path, opts);
  if (!fs.existsSync(abs)) return "";
  return fs.readFileSync(abs, "utf8");
}

export function writeFile(opts: {
  path: string;
  content: string;
} & FsRootOpts): {
  path: string;
  bytes: number;
  created: boolean;
} {
  const abs = resolveRepoPath(opts.path, opts);
  const created = !fs.existsSync(abs);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const content = String(opts.content ?? "");
  fs.writeFileSync(abs, content, "utf8");
  return { path: opts.path, bytes: Buffer.byteLength(content, "utf8"), created };
}

export function editFile(opts: {
  path: string;
  old_string: string;
  new_string: string;
} & FsRootOpts): { path: string; replacements: number; bytes: number } {
  const abs = resolveRepoPath(opts.path, opts);
  if (!fs.existsSync(abs)) throw new Error(`File not found: ${opts.path}`);
  const oldStr = String(opts.old_string ?? "");
  const newStr = String(opts.new_string ?? "");
  if (!oldStr) throw new Error("old_string required");
  const content = fs.readFileSync(abs, "utf8");
  const count = content.split(oldStr).length - 1;
  if (count === 0) throw new Error("old_string not found in file");
  if (count > 1) throw new Error(`old_string is not unique (${count} matches)`);
  const next = content.replace(oldStr, newStr);
  fs.writeFileSync(abs, next, "utf8");
  return {
    path: opts.path,
    replacements: 1,
    bytes: Buffer.byteLength(next, "utf8"),
  };
}

export function deleteFile(opts: {
  path: string;
} & FsRootOpts): { path: string; deleted: boolean } {
  const abs = resolveRepoPath(opts.path, opts);
  if (!fs.existsSync(abs)) return { path: opts.path, deleted: false };
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) throw new Error("Cannot delete a directory with delete_file");
  fs.unlinkSync(abs);
  return { path: opts.path, deleted: true };
}

/** Delete a file, or an empty directory (no recursive wipe). */
export function deletePath(opts: {
  path: string;
} & FsRootOpts): { path: string; deleted: boolean; type: "file" | "dir" | null } {
  const abs = resolveRepoPath(opts.path, opts);
  if (!fs.existsSync(abs)) return { path: opts.path, deleted: false, type: null };
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) {
    const kids = fs.readdirSync(abs).filter((n) => n !== "." && n !== "..");
    if (kids.length > 0) {
      throw new Error(`Directory is not empty: ${opts.path}`);
    }
    fs.rmdirSync(abs);
    return { path: opts.path, deleted: true, type: "dir" };
  }
  fs.unlinkSync(abs);
  return { path: opts.path, deleted: true, type: "file" };
}

export function mkdirPath(opts: {
  path: string;
} & FsRootOpts): { path: string; created: boolean } {
  const abs = resolveRepoPath(opts.path, opts);
  if (fs.existsSync(abs)) {
    const stat = fs.statSync(abs);
    if (!stat.isDirectory()) throw new Error(`Not a directory: ${opts.path}`);
    return { path: opts.path, created: false };
  }
  fs.mkdirSync(abs, { recursive: true });
  return { path: opts.path, created: true };
}

export function renamePath(opts: {
  from: string;
  to: string;
} & FsRootOpts): { from: string; to: string } {
  const fromAbs = resolveRepoPath(opts.from, opts);
  const toAbs = resolveRepoPath(opts.to, opts);
  if (!fs.existsSync(fromAbs)) throw new Error(`Path not found: ${opts.from}`);
  if (fs.existsSync(toAbs)) throw new Error(`Destination already exists: ${opts.to}`);
  fs.mkdirSync(path.dirname(toAbs), { recursive: true });
  fs.renameSync(fromAbs, toAbs);
  return { from: opts.from, to: opts.to };
}

export function listDir(opts: {
  path?: string;
  recursive?: boolean;
} & FsRootOpts): { path: string; entries: Array<{ name: string; type: "file" | "dir" }> } {
  const rel = opts.path?.trim() || ".";
  const abs = resolveRepoPath(rel, opts);
  if (!fs.existsSync(abs)) throw new Error(`Directory not found: ${rel}`);
  const entries: Array<{ name: string; type: "file" | "dir" }> = [];
  const walk = (dir: string, prefix: string) => {
    for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
      if (name.name === "node_modules" || name.name === ".git") continue;
      const relPath = prefix ? `${prefix}/${name.name}` : name.name;
      entries.push({ name: relPath, type: name.isDirectory() ? "dir" : "file" });
      if (opts.recursive && name.isDirectory()) {
        walk(path.join(dir, name.name), relPath);
      }
    }
  };
  const stat = fs.statSync(abs);
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${rel}`);
  walk(abs, rel === "." ? "" : rel);
  return { path: rel, entries: entries.slice(0, 500) };
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/\\\\]*")
    .replace(/\?/g, "[^/\\\\]")
    .replace(/{{GLOBSTAR}}/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

export function globFiles(opts: {
  pattern: string;
  cwd?: string;
} & FsRootOpts): { pattern: string; matches: string[] } {
  const root = resolveRepoPath(opts.cwd?.trim() || ".", opts);
  const re = globToRegExp(opts.pattern.replace(/\\/g, "/"));
  const matches: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === "node_modules" || ent.name === ".git") continue;
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(abs, rel);
      else if (re.test(rel.replace(/\\/g, "/"))) matches.push(rel);
      if (matches.length >= 200) return;
    }
  };
  walk(root, opts.cwd?.trim() && opts.cwd !== "." ? opts.cwd.replace(/\\/g, "/") : "");
  return { pattern: opts.pattern, matches };
}

function grepNode(opts: {
  pattern: string;
  path?: string;
  glob?: string;
  caseInsensitive?: boolean;
} & FsRootOpts): string {
  const root = resolveRepoPath(opts.path?.trim() || ".", opts);
  const flags = opts.caseInsensitive ? "i" : "";
  const re = new RegExp(opts.pattern, flags);
  const globRe = opts.glob ? globToRegExp(opts.glob) : null;
  const lines: string[] = [];
  const walk = (file: string, rel: string) => {
    if (globRe && !globRe.test(rel.replace(/\\/g, "/"))) return;
    let content: string;
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024) return;
      content = fs.readFileSync(file, "utf8");
    } catch {
      return;
    }
    content.split(/\r?\n/).forEach((line, i) => {
      if (re.test(line)) {
        lines.push(`${rel}:${i + 1}:${line}`);
      }
    });
  };
  const stat = fs.statSync(root);
  if (stat.isFile()) walk(root, opts.path ?? ".");
  else {
    const visit = (dir: string, prefix: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.name === "node_modules" || ent.name === ".git") continue;
        const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
        const abs = path.join(dir, ent.name);
        if (ent.isDirectory()) visit(abs, rel);
        else walk(abs, rel);
        if (lines.length >= 500) return;
      }
    };
    visit(root, opts.path?.trim() && opts.path !== "." ? opts.path.replace(/\\/g, "/") : "");
  }
  return budgetText(lines.join("\n"));
}

export async function grepSearch(opts: {
  pattern: string;
  path?: string;
  glob?: string;
  caseInsensitive?: boolean;
  tenantId?: string | null;
  root?: string;
}): Promise<{ pattern: string; output: string; engine: "rg" | "node" }> {
  const root = resolveRepoPath(opts.path?.trim() || ".", {
    tenantId: opts.tenantId,
    root: opts.root,
  });
  const rgArgs = [
    "--line-number",
    "--no-heading",
    "--color=never",
    "--max-count=500",
    opts.pattern,
    root,
  ];
  if (opts.glob) rgArgs.splice(0, 0, "--glob", opts.glob);
  if (opts.caseInsensitive) rgArgs.splice(0, 0, "-i");

  const tryRg = (): Promise<string | null> =>
    new Promise((resolve) => {
      const proc = spawn("rg", rgArgs, { windowsHide: true });
      let out = "";
      proc.stdout?.on("data", (c) => {
        out += String(c);
      });
      proc.on("error", () => resolve(null));
      proc.on("close", (code) => {
        if (code === 0 || code === 1) resolve(budgetText(out.trim()));
        else resolve(null);
      });
    });

  const rgOut = await tryRg();
  if (rgOut != null) {
    return { pattern: opts.pattern, output: rgOut || "(no matches)", engine: "rg" };
  }
  return {
    pattern: opts.pattern,
    output: grepNode(opts) || "(no matches)",
    engine: "node",
  };
}

/** Build a unified diff for display in confirm/review UI. */
export function computeUnifiedDiff(
  oldContent: string,
  newContent: string,
  filePath: string
): string {
  const oldLines = oldContent.split(/\r?\n/);
  const newLines = newContent.split(/\r?\n/);
  const header = [`--- a/${filePath}`, `+++ b/${filePath}`];
  const hunks: string[] = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      i++;
      j++;
      continue;
    }
    const startI = i;
    const startJ = j;
    while (
      i < oldLines.length &&
      j < newLines.length &&
      oldLines[i] !== newLines[j]
    ) {
      i++;
      j++;
    }
    const oldSlice = oldLines.slice(startI, i);
    const newSlice = newLines.slice(startJ, j);
    hunks.push(
      `@@ -${startI + 1},${oldSlice.length} +${startJ + 1},${newSlice.length} @@`
    );
    for (const l of oldSlice) hunks.push(`-${l}`);
    for (const l of newSlice) hunks.push(`+${l}`);
    if (i === startI && j === startJ) break;
  }
  if (hunks.length === 0) return "";
  return [...header, ...hunks].join("\n");
}

const PREVIEW_DIFF_CAP = 8_000;

/** Apply unified-diff hunks to in-memory content (no disk writes). */
export function applyPatchToContent(original: string, patch: string): string {
  const lines = original.split(/\r?\n/);
  const patchLines = String(patch ?? "").split(/\r?\n/);
  let out = [...lines];
  let idx = 0;
  while (idx < patchLines.length) {
    const line = patchLines[idx];
    if (line.startsWith("@@")) {
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (!m) throw new Error("Invalid patch hunk header");
      const startOld = Number(m[1]) - 1;
      idx++;
      const removed: string[] = [];
      const added: string[] = [];
      while (idx < patchLines.length && !patchLines[idx].startsWith("@@")) {
        const pl = patchLines[idx];
        if (pl.startsWith("-")) removed.push(pl.slice(1));
        else if (pl.startsWith("+")) added.push(pl.slice(1));
        else if (pl.startsWith(" ")) {
          removed.push(pl.slice(1));
          added.push(pl.slice(1));
        }
        idx++;
      }
      const slice = out.slice(startOld, startOld + removed.length);
      if (slice.join("\n") !== removed.join("\n")) {
        throw new Error(`Patch context mismatch at line ${startOld + 1}`);
      }
      out.splice(startOld, removed.length, ...added);
    } else {
      idx++;
    }
  }
  return out.join("\n");
}

export type WriteToolPreview = {
  previewDiff?: string;
  previewError?: string;
};

/**
 * Dry-run unified diff for write tools shown on confirm (no disk mutation).
 */
export function previewWriteToolDiff(
  toolName: string,
  args: Record<string, unknown>,
  opts?: { tenantId?: string | null; root?: string }
): WriteToolPreview {
  try {
    if (
      toolName !== "edit_file" &&
      toolName !== "write_file" &&
      toolName !== "apply_patch"
    ) {
      return {};
    }
    const filePath = String(args.path ?? "").trim();
    if (!filePath) return { previewError: "path required" };
    const rootOpts = { tenantId: opts?.tenantId, root: opts?.root };

    if (toolName === "write_file") {
      const prior = readFileRaw({ path: filePath, ...rootOpts });
      const next = String(args.content ?? "");
      const diff = computeUnifiedDiff(prior, next, filePath);
      if (!diff) return { previewDiff: "(no changes)" };
      return {
        previewDiff:
          diff.length > PREVIEW_DIFF_CAP
            ? `${diff.slice(0, PREVIEW_DIFF_CAP)}\n…[truncated]`
            : diff,
      };
    }

    if (toolName === "edit_file") {
      const abs = resolveRepoPath(filePath, rootOpts);
      if (!fs.existsSync(abs)) {
        return { previewError: `File not found: ${filePath}` };
      }
      const oldStr = String(args.old_string ?? "");
      const newStr = String(args.new_string ?? "");
      if (!oldStr) return { previewError: "old_string required" };
      const content = fs.readFileSync(abs, "utf8");
      const count = content.split(oldStr).length - 1;
      if (count === 0) return { previewError: "old_string not found in file" };
      if (count > 1) {
        return { previewError: `old_string is not unique (${count} matches)` };
      }
      const next = content.replace(oldStr, newStr);
      const diff = computeUnifiedDiff(content, next, filePath);
      if (!diff) return { previewDiff: "(no changes)" };
      return {
        previewDiff:
          diff.length > PREVIEW_DIFF_CAP
            ? `${diff.slice(0, PREVIEW_DIFF_CAP)}\n…[truncated]`
            : diff,
      };
    }

    // apply_patch
    const abs = resolveRepoPath(filePath, rootOpts);
    if (!fs.existsSync(abs)) {
      return { previewError: `File not found: ${filePath}` };
    }
    const original = fs.readFileSync(abs, "utf8");
    const next = applyPatchToContent(original, String(args.patch ?? ""));
    const diff = computeUnifiedDiff(original, next, filePath);
    if (!diff) return { previewDiff: "(no changes)" };
    return {
      previewDiff:
        diff.length > PREVIEW_DIFF_CAP
          ? `${diff.slice(0, PREVIEW_DIFF_CAP)}\n…[truncated]`
          : diff,
    };
  } catch (err) {
    return {
      previewError: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Apply a unified diff patch to a file (multi-hunk, Cursor-style). */
export function applyPatch(opts: {
  path: string;
  patch: string;
} & FsRootOpts): { path: string; diff: string; bytes: number } {
  const abs = resolveRepoPath(opts.path, opts);
  if (!fs.existsSync(abs)) throw new Error(`File not found: ${opts.path}`);
  const original = fs.readFileSync(abs, "utf8");
  const next = applyPatchToContent(original, opts.patch);
  fs.writeFileSync(abs, next, "utf8");
  const diff = computeUnifiedDiff(original, next, opts.path);
  return { path: opts.path, diff, bytes: Buffer.byteLength(next, "utf8") };
}

/** Revert a file to git HEAD (best-effort). */
export function revertFile(opts: {
  path: string;
} & FsRootOpts): Promise<{ path: string; reverted: boolean; output: string }> {
  const abs = resolveRepoPath(opts.path, opts);
  const codingRoot = resolveCodingRoot(opts);
  return new Promise((resolve, reject) => {
    const proc = spawn("git", ["checkout", "HEAD", "--", abs], {
      cwd: codingRoot,
      shell: process.platform === "win32",
      windowsHide: true,
    });
    let out = "";
    proc.stdout?.on("data", (c) => {
      out += String(c);
    });
    proc.stderr?.on("data", (c) => {
      out += String(c);
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      resolve({ path: opts.path, reverted: code === 0, output: out.trim() });
    });
  });
}
