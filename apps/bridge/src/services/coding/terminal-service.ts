import path from "node:path";
import { spawn } from "node:child_process";
import { resolveCodingRoot, resolveRepoPath } from "./fs-tools.js";
import {
  assertSandboxReadyForTerminal,
  buildBubblewrapArgs,
  requiresTerminalSandbox,
  scrubTerminalEnv,
} from "./terminal-sandbox.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 512 * 1024;

export interface RunTerminalOpts {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  tenantId?: string | null;
  root?: string;
  /** Stream stdout/stderr chunks live (SSE terminal_output). */
  onOutput?: (chunk: { stream: "stdout" | "stderr"; text: string }) => void;
}

export interface RunTerminalResult {
  command: string;
  cwd: string;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  sandboxed?: boolean;
}

function budget(text: string): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= MAX_OUTPUT_BYTES) return text;
  return buf.subarray(0, MAX_OUTPUT_BYTES).toString("utf8") + "\n…[truncated]";
}

export function runTerminal(opts: RunTerminalOpts): Promise<RunTerminalResult> {
  const command = String(opts.command ?? "").trim();
  if (!command) throw new Error("command required");
  const rootOpts = { tenantId: opts.tenantId, root: opts.root };
  const cwdRel = opts.cwd?.trim() || ".";
  const cwd = resolveRepoPath(cwdRel, rootOpts);
  const codingRoot = resolveCodingRoot(rootOpts);
  const timeoutMs = Math.min(
    Math.max(Number(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS), 1000),
    600_000
  );

  const sandboxed = requiresTerminalSandbox();
  if (sandboxed) {
    assertSandboxReadyForTerminal();
  }

  return new Promise((resolve, reject) => {
    let proc;
    if (sandboxed) {
      const bwrapArgs = buildBubblewrapArgs({
        codingRoot,
        cwd,
        command,
      });
      proc = spawn("bwrap", bwrapArgs, {
        cwd: codingRoot,
        shell: false,
        windowsHide: true,
        env: scrubTerminalEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } else {
      const shell = process.platform === "win32";
      proc = spawn(command, [], {
        cwd,
        shell,
        windowsHide: true,
        env: scrubTerminalEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const onAbort = () => {
      timedOut = true;
      try {
        proc.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    };
    opts.abortSignal?.addEventListener("abort", onAbort);

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }, timeoutMs);

    proc.stdout?.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      opts.onOutput?.({ stream: "stdout", text });
    });
    proc.stderr?.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      opts.onOutput?.({ stream: "stderr", text });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      opts.abortSignal?.removeEventListener("abort", onAbort);
      reject(err);
    });

    proc.on("close", (code, signal) => {
      clearTimeout(timer);
      opts.abortSignal?.removeEventListener("abort", onAbort);
      resolve({
        command,
        cwd: path.relative(codingRoot, cwd).replace(/\\/g, "/") || ".",
        exitCode: code,
        signal: signal ?? null,
        stdout: budget(stdout),
        stderr: budget(stderr),
        timedOut,
        sandboxed,
      });
    });
  });
}
