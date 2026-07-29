/**
 * Shared sandboxed process runner for Layer 3 (#112).
 * Helpers (rg / tsc / git) and optional terminal use the same bwrap boundary.
 */
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import {
  assertSandboxReadyForTerminal,
  buildBubblewrapArgs,
  requiresTerminalSandbox,
  scrubTerminalEnv,
  type CodingTerminalNet,
} from "./terminal-sandbox.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 512 * 1024;

export type SandboxedProcessResult = {
  argv: string[];
  command: string;
  cwd: string;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  sandboxed: boolean;
  netMode: CodingTerminalNet;
};

function budget(text: string): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= MAX_OUTPUT_BYTES) return text;
  return buf.subarray(0, MAX_OUTPUT_BYTES).toString("utf8") + "\n…[truncated]";
}

/** POSIX single-quote shell escaping for argv → `/bin/sh -c`. */
export function shellQuoteArg(arg: string): string {
  return `'${String(arg).replace(/'/g, `'\\''`)}'`;
}

export function shellQuoteArgv(argv: readonly string[]): string {
  if (!argv.length) throw new Error("argv required");
  return argv.map(shellQuoteArg).join(" ");
}

export type RunSandboxedArgvOpts = {
  codingRoot: string;
  cwd: string;
  argv: readonly string[];
  timeoutMs?: number;
  /**
   * Helpers default to none (no egress). Terminal may pass allowlist/shared.
   */
  net?: CodingTerminalNet;
  /** Extra env merged after scrub (e.g. GIT_AUTHOR_*). Host path only. */
  envExtra?: NodeJS.ProcessEnv;
  abortSignal?: AbortSignal;
  onOutput?: (chunk: { stream: "stdout" | "stderr"; text: string }) => void;
  /**
   * Allowlist-only: jail proxy URL + host egress bind (required when net=allowlist).
   */
  proxyUrl?: string;
  jailSocketPath?: string;
  hostEgressDir?: string;
};

function resolvePaths(opts: RunSandboxedArgvOpts): {
  codingRoot: string;
  cwd: string;
  command: string;
  timeoutMs: number;
  net: CodingTerminalNet;
  sandboxed: boolean;
  argv: string[];
} {
  const argv = opts.argv.map(String);
  if (!argv.length || !argv[0]?.trim()) {
    throw new Error("argv required");
  }
  const codingRoot = path.resolve(opts.codingRoot);
  const cwd = path.resolve(opts.cwd);
  const rel = path.relative(codingRoot, cwd);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Process cwd escapes coding root");
  }
  const sandboxed = requiresTerminalSandbox();
  if (sandboxed) {
    assertSandboxReadyForTerminal();
  }
  const net: CodingTerminalNet = opts.net ?? "none";
  const timeoutMs = Math.min(
    Math.max(Number(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS), 1000),
    600_000
  );
  // Windows host: use .cmd shim without shell:true (which mangles spaced argv).
  if (!sandboxed && process.platform === "win32" && argv[0] === "npx") {
    argv[0] = "npx.cmd";
  }
  // Inside the jail always use POSIX `npx` (Linux hub image).
  const commandArgv =
    sandboxed && argv[0] === "npx.cmd" ? ["npx", ...argv.slice(1)] : argv;
  return {
    codingRoot,
    cwd,
    command: shellQuoteArgv(commandArgv),
    timeoutMs,
    net,
    sandboxed,
    argv,
  };
}

function hostEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...scrubTerminalEnv(), ...(extra ?? {}) };
}

/** Async sandboxed (or host) argv runner. */
export function runSandboxedArgv(
  opts: RunSandboxedArgvOpts
): Promise<SandboxedProcessResult> {
  let codingRoot: string;
  let cwd: string;
  let command: string;
  let timeoutMs: number;
  let net: CodingTerminalNet;
  let sandboxed: boolean;
  let argv: string[];
  try {
    const resolved = resolvePaths(opts);
    codingRoot = resolved.codingRoot;
    cwd = resolved.cwd;
    command = resolved.command;
    timeoutMs = resolved.timeoutMs;
    net = resolved.net;
    sandboxed = resolved.sandboxed;
    argv = resolved.argv;
  } catch (err) {
    return Promise.reject(err);
  }

  return new Promise((resolve, reject) => {
    let proc;
    if (sandboxed) {
      const bwrapArgs = buildBubblewrapArgs({
        codingRoot,
        cwd,
        command,
        net,
        proxyUrl: opts.proxyUrl,
        jailSocketPath: opts.jailSocketPath,
        hostEgressDir: opts.hostEgressDir,
      });
      proc = spawn("bwrap", bwrapArgs, {
        cwd: codingRoot,
        shell: false,
        windowsHide: true,
        env: hostEnv(opts.envExtra),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } else {
      proc = spawn(argv[0]!, argv.slice(1), {
        cwd,
        shell: false,
        windowsHide: true,
        env: hostEnv(opts.envExtra),
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
        argv,
        command,
        cwd: path.relative(codingRoot, cwd).replace(/\\/g, "/") || ".",
        exitCode: code,
        signal: signal ?? null,
        stdout: budget(stdout),
        stderr: budget(stderr),
        timedOut,
        sandboxed,
        netMode: net,
      });
    });
  });
}

/** Sync sandboxed (or host) argv runner for worktree git. */
export function runSandboxedArgvSync(
  opts: Omit<RunSandboxedArgvOpts, "abortSignal" | "onOutput">
): SandboxedProcessResult {
  const { codingRoot, cwd, command, timeoutMs, net, sandboxed, argv } =
    resolvePaths(opts);

  let status: number | null = null;
  let signal: string | null = null;
  let stdout = "";
  let stderr = "";
  let timedOut = false;

  if (sandboxed) {
    const bwrapArgs = buildBubblewrapArgs({
      codingRoot,
      cwd,
      command,
      net,
      proxyUrl: opts.proxyUrl,
      jailSocketPath: opts.jailSocketPath,
      hostEgressDir: opts.hostEgressDir,
    });
    const res = spawnSync("bwrap", bwrapArgs, {
      cwd: codingRoot,
      encoding: "utf8",
      windowsHide: true,
      timeout: timeoutMs,
      env: hostEnv(opts.envExtra),
    });
    if (res.error && (res.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
      timedOut = true;
    } else if (res.error) {
      throw res.error;
    }
    status = res.status;
    signal = res.signal;
    stdout = String(res.stdout ?? "");
    stderr = String(res.stderr ?? "");
  } else {
    const res = spawnSync(argv[0]!, argv.slice(1), {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      timeout: timeoutMs,
      env: hostEnv(opts.envExtra),
      shell: false,
    });
    if (res.error && (res.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
      timedOut = true;
    } else if (res.error) {
      throw res.error;
    }
    status = res.status;
    signal = res.signal;
    stdout = String(res.stdout ?? "");
    stderr = String(res.stderr ?? "");
  }

  return {
    argv,
    command,
    cwd: path.relative(codingRoot, cwd).replace(/\\/g, "/") || ".",
    exitCode: status,
    signal,
    stdout: budget(stdout),
    stderr: budget(stderr),
    timedOut,
    sandboxed,
    netMode: net,
  };
}
