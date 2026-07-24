import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { config } from "../../config.js";
import { resolveRepoPath } from "./fs-tools.js";

export interface DiagnosticItem {
  file: string;
  line: number;
  column?: number;
  severity: "error" | "warning";
  message: string;
}

export type WriteVerification = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  diagnostics: DiagnosticItem[];
};

const DEFAULT_TSC_TIMEOUT_MS = 20_000;

export function isTypeScriptPath(filePath: string): boolean {
  return /\.(tsx?|mts|cts)$/i.test(filePath.trim());
}

export function hasTypeScriptConfig(cwd: string): boolean {
  return (
    existsSync(path.join(cwd, "tsconfig.json")) ||
    existsSync(path.join(cwd, "tsconfig.app.json")) ||
    existsSync(path.join(cwd, "tsconfig.base.json"))
  );
}

/** Run TypeScript check and return structured diagnostics (Cursor verify step). */
export function readDiagnostics(opts?: {
  cwd?: string;
  tenantId?: string | null;
  timeoutMs?: number;
}): Promise<{ ok: boolean; diagnostics: DiagnosticItem[]; raw: string }> {
  const cwd = resolveRepoPath(opts?.cwd?.trim() || ".", { tenantId: opts?.tenantId });
  const root = config.repoRoot;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TSC_TIMEOUT_MS;

  return new Promise((resolve) => {
    const proc = spawn("npx", ["tsc", "--noEmit", "--pretty", "false"], {
      cwd,
      shell: process.platform === "win32",
      windowsHide: true,
      env: { ...process.env },
    });

    let out = "";
    let settled = false;
    const finish = (payload: {
      ok: boolean;
      diagnostics: DiagnosticItem[];
      raw: string;
    }) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };

    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
      finish({
        ok: false,
        diagnostics: [
          {
            file: ".",
            line: 1,
            severity: "error",
            message: `tsc timed out after ${timeoutMs}ms`,
          },
        ],
        raw: out.slice(0, 32_000),
      });
    }, timeoutMs);

    proc.stdout?.on("data", (c) => {
      out += String(c);
    });
    proc.stderr?.on("data", (c) => {
      out += String(c);
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      const diagnostics = parseTscOutput(out, root);
      finish({ ok: code === 0, diagnostics, raw: out.slice(0, 32_000) });
    });

    proc.on("error", () => {
      clearTimeout(timer);
      finish({
        ok: false,
        diagnostics: [
          {
            file: ".",
            line: 1,
            severity: "error",
            message: "Failed to run tsc - is TypeScript installed?",
          },
        ],
        raw: "",
      });
    });
  });
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Prefer diagnostics for the edited file; keep a few others for context. */
export function filterDiagnosticsForPath(
  diagnostics: DiagnosticItem[],
  filePath: string,
  limit = 25
): DiagnosticItem[] {
  const target = normalizePath(filePath);
  const forFile: DiagnosticItem[] = [];
  const others: DiagnosticItem[] = [];
  for (const d of diagnostics) {
    const f = normalizePath(d.file);
    if (f === target || f.endsWith(`/${target}`) || target.endsWith(`/${f}`)) {
      forFile.push(d);
    } else {
      others.push(d);
    }
  }
  return [...forFile, ...others.slice(0, 5)].slice(0, limit);
}

/**
 * After a successful write tool, optionally run tsc and attach a compact
 * verification payload. Never throws; skips non-TS paths and missing tsconfig.
 */
export async function verifyTypeScriptAfterWrite(
  opts: {
    path: string;
    tenantId?: string | null;
    timeoutMs?: number;
  },
  runner: typeof readDiagnostics = readDiagnostics
): Promise<WriteVerification> {
  const filePath = opts.path.trim();
  if (!isTypeScriptPath(filePath)) {
    return {
      ok: true,
      skipped: true,
      reason: "not_typescript",
      diagnostics: [],
    };
  }

  let cwd: string;
  try {
    cwd = resolveRepoPath(".", { tenantId: opts.tenantId });
  } catch {
    return {
      ok: true,
      skipped: true,
      reason: "bad_root",
      diagnostics: [],
    };
  }

  if (!hasTypeScriptConfig(cwd)) {
    return {
      ok: true,
      skipped: true,
      reason: "no_tsconfig",
      diagnostics: [],
    };
  }

  const result = await runner({
    cwd: ".",
    tenantId: opts.tenantId,
    timeoutMs: opts.timeoutMs,
  });
  const diagnostics = filterDiagnosticsForPath(result.diagnostics, filePath);
  const fileHasError = diagnostics.some(
    (d) =>
      d.severity === "error" &&
      (normalizePath(d.file) === normalizePath(filePath) ||
        normalizePath(d.file).endsWith(`/${normalizePath(filePath)}`) ||
        normalizePath(filePath).endsWith(`/${normalizePath(d.file)}`))
  );
  return {
    ok: !fileHasError,
    diagnostics,
  };
}

function parseTscOutput(raw: string, repoRoot: string): DiagnosticItem[] {
  const items: DiagnosticItem[] = [];
  const re = /^(.+)\((\d+),(\d+)\):\s+(error|warning)\s+TS\d+:\s+(.*)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const abs = m[1];
    const rel = path.relative(repoRoot, abs).replace(/\\/g, "/");
    items.push({
      file: rel.startsWith("..") ? abs : rel,
      line: Number(m[2]),
      column: Number(m[3]),
      severity: m[4] as "error" | "warning",
      message: m[5].trim(),
    });
  }
  return items.slice(0, 100);
}
