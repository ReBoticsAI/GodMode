/**
 * Buyer protection (#177): pin Official/Community plugin installs to an
 * immutable git ref (tag or commit). Fail closed on floating refs and digest drift.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { CatalogEntry } from "./marketplace-catalog.js";
import { config } from "../config.js";

const FLOATING_REFS = new Set(["", "main", "master", "head", "origin/main", "origin/master"]);

export type PluginPinPolicy = "required" | "optional";

export function normalizePluginRef(ref: string | undefined | null): string {
  return String(ref ?? "").trim();
}

export function isFloatingPluginRef(ref: string | undefined | null): boolean {
  const normalized = normalizePluginRef(ref).toLowerCase();
  return FLOATING_REFS.has(normalized);
}

export function isCommitLikeRef(ref: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(ref.trim());
}

/**
 * Official and Community catalog installs must pin. Local folder installs and
 * operator third-party Local catalogs may omit a pin (self-host convenience).
 */
export function resolvePluginPinPolicy(opts: {
  entry: CatalogEntry;
  sourceCatalog?: string;
}): PluginPinPolicy {
  if (opts.entry.pluginLocalPath?.trim()) return "optional";
  const sourceName = String(opts.entry.sourceName ?? "").toLowerCase();
  if (sourceName.includes("official") || sourceName.includes("community")) {
    return "required";
  }
  const src = String(
    opts.sourceCatalog ?? opts.entry.sourceCatalog ?? ""
  ).toLowerCase();
  if (
    src.includes("/catalog/official") ||
    src.includes("commerce/catalog/official") ||
    src.includes("godmode-marketplace")
  ) {
    return "required";
  }
  if (config.isSaas && opts.entry.pluginRepo?.trim()) return "required";
  return "optional";
}

export function assertPluginInstallPin(
  entry: CatalogEntry,
  policy: PluginPinPolicy
): { ref: string; digest?: string } {
  const ref = normalizePluginRef(entry.pluginRef);
  const digest = normalizePluginRef(
    (entry as CatalogEntry & { pluginDigest?: string }).pluginDigest
  );

  if (policy === "required") {
    if (isFloatingPluginRef(ref)) {
      throw new Error(
        `Catalog entry "${entry.id}" is missing a pinned pluginRef (tag or commit). ` +
          `Floating refs like main/master are not allowed for Official/Community installs (#177).`
      );
    }
  }

  const effectiveRef = ref || "main";
  if (policy === "optional" && isFloatingPluginRef(ref) && !digest) {
    return { ref: effectiveRef };
  }
  if (digest && !/^[0-9a-f]{7,40}$/i.test(digest)) {
    throw new Error(
      `Catalog entry "${entry.id}" has an invalid pluginDigest (expected hex commit sha).`
    );
  }
  return { ref: effectiveRef, digest: digest || undefined };
}

export function readGitHead(pluginRoot: string): string {
  return execSync("git rev-parse HEAD", {
    cwd: pluginRoot,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  }).trim();
}

export function assertGitHeadMatchesDigest(
  pluginRoot: string,
  digest: string,
  entryId: string
): void {
  const head = readGitHead(pluginRoot).toLowerCase();
  const want = digest.trim().toLowerCase();
  if (head === want || head.startsWith(want) || want.startsWith(head)) return;
  throw new Error(
    `Pinned digest mismatch for "${entryId}": expected ${digest}, got ${head}. Fail closed (#177).`
  );
}

/** Clone or reset a plugin checkout to an immutable ref; verify digest when set. */
export function materializePinnedPluginCheckout(opts: {
  target: string;
  cloneUrl: string;
  ref: string;
  digest?: string;
  entryId: string;
}): void {
  const { target, cloneUrl, ref, digest, entryId } = opts;
  const run = (cmd: string, cwd?: string) =>
    execSync(cmd, { cwd, stdio: "pipe", encoding: "utf8" });

  const freshClone = () => {
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (isCommitLikeRef(ref)) {
      run(`git clone --depth 1 ${shellQuote(cloneUrl)} ${shellQuote(target)}`);
      run(`git fetch --depth 1 origin ${shellQuote(ref)}`, target);
      run(`git checkout --force ${shellQuote(ref)}`, target);
    } else {
      run(
        `git clone --depth 1 --branch ${shellQuote(ref)} ${shellQuote(cloneUrl)} ${shellQuote(target)}`
      );
    }
  };

  if (!fs.existsSync(target)) {
    freshClone();
  } else {
    try {
      run("git rev-parse --is-inside-work-tree", target);
      run(`git fetch --depth 1 origin ${shellQuote(ref)}`, target);
      if (isCommitLikeRef(ref)) {
        run(`git checkout --force ${shellQuote(ref)}`, target);
      } else {
        run(`git checkout --force FETCH_HEAD`, target);
      }
    } catch {
      freshClone();
    }
  }

  if (digest) {
    assertGitHeadMatchesDigest(target, digest, entryId);
  } else if (isCommitLikeRef(ref)) {
    assertGitHeadMatchesDigest(target, ref, entryId);
  }
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@+-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}
