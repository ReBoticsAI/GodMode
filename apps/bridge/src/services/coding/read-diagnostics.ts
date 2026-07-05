import { spawn } from "node:child_process";
import path from "node:path";
import { config } from "../../config.js";
import { resolveRepoPath, type FsRootOpts } from "./fs-tools.js";

export interface DiagnosticItem {
  file: string;
  line: number;
  column?: number;
  severity: "error" | "warning";
  message: string;
}

/** Run TypeScript check and return structured diagnostics (Cursor verify step). */
export function readDiagnostics(opts?: {
  cwd?: string;
  tenantId?: string | null;
}): Promise<{ ok: boolean; diagnostics: DiagnosticItem[]; raw: string }> {
  const cwd = resolveRepoPath(opts?.cwd?.trim() || ".", { tenantId: opts?.tenantId });
  const root = config.repoRoot;

  return new Promise((resolve) => {
    const proc = spawn("npx", ["tsc", "--noEmit", "--pretty", "false"], {
      cwd,
      shell: process.platform === "win32",
      windowsHide: true,
      env: { ...process.env },
    });

    let out = "";
    proc.stdout?.on("data", (c) => {
      out += String(c);
    });
    proc.stderr?.on("data", (c) => {
      out += String(c);
    });

    proc.on("close", (code) => {
      const diagnostics = parseTscOutput(out, root);
      resolve({ ok: code === 0, diagnostics, raw: out.slice(0, 32_000) });
    });

    proc.on("error", () => {
      resolve({
        ok: false,
        diagnostics: [
          {
            file: ".",
            line: 1,
            severity: "error",
            message: "Failed to run tsc — is TypeScript installed?",
          },
        ],
        raw: "",
      });
    });
  });
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
