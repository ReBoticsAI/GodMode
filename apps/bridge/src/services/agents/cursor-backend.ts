import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentBackend, AgentRunRequest } from "./backend.js";
import type { AgentCursorConfig } from "./types.js";
import { config } from "../../config.js";
import { buildContractorContextBundle } from "../contractor-context.js";

/**
 * Resolve the `cursor-agent` executable. The Windows installer drops a
 * `cursor-agent.cmd` shim in %LOCALAPPDATA%\cursor-agent; on *nix it lands in
 * ~/.local/bin. Fall back to bare "cursor-agent" (PATH) when neither is found.
 */
export function resolveCursorAgentCommand(explicit?: string): string {
  if (explicit && explicit.trim()) return explicit;
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA;
    if (local) {
      const cmd = join(local, "cursor-agent", "cursor-agent.cmd");
      if (existsSync(cmd)) return cmd;
    }
  } else {
    const home = process.env.HOME;
    if (home) {
      const bin = join(home, ".local", "bin", "cursor-agent");
      if (existsSync(bin)) return bin;
    }
  }
  return "cursor-agent";
}

export interface CursorRunOptions {
  prompt: string;
  model?: string;
  workspace?: string;
  worktree?: boolean | string;
  worktreeBase?: string;
  sandbox?: "enabled" | "disabled";
  force?: boolean;
  mode?: "plan" | "ask";
  /** Resume a prior cursor-agent session by chat id. */
  resume?: string;
  timeoutMs?: number;
  command?: string;
  extraArgs?: string[];
  onToken?: (chunk: string) => void;
}

export interface CursorRunResult {
  text: string;
  sessionId?: string;
  isError: boolean;
  raw?: Record<string, unknown>;
}

/** Pull the final `{ type: "result", ... }` object out of cursor-agent output. */
function parseResult(stdout: string): CursorRunResult | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  // `--output-format json` emits a single object; `stream-json` is NDJSON.
  // Scan from the end for the terminal result object either way.
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().startsWith("{"));
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]) as Record<string, unknown>;
      if (obj.type === "result" || "result" in obj) {
        const result = obj.result;
        return {
          text:
            typeof result === "string"
              ? result
              : result != null
                ? JSON.stringify(result)
                : "",
          sessionId:
            typeof obj.session_id === "string" ? obj.session_id : undefined,
          isError: obj.is_error === true,
          raw: obj,
        };
      }
    } catch {
      /* keep scanning earlier lines */
    }
  }
  return null;
}

/**
 * Invoke the Cursor CLI headlessly and return its final answer. Authentication
 * comes from the stored `cursor-agent login` session (or CURSOR_API_KEY in the
 * bridge env). `--trust` is always passed since there is no interactive prompt.
 */
export async function runCursorAgent(
  opts: CursorRunOptions
): Promise<CursorRunResult> {
  const prompt = opts.prompt.trim();
  if (!prompt) throw new Error("cursor-agent requires a prompt");

  const command = resolveCursorAgentCommand(opts.command);
  const args: string[] = ["-p", "--output-format", "json", "--trust"];
  args.push("--model", opts.model?.trim() || "auto");
  if (opts.mode) args.push("--mode", opts.mode);
  if (opts.resume) args.push("--resume", opts.resume);
  if (opts.workspace) args.push("--workspace", opts.workspace);
  if (opts.worktree) {
    args.push("--worktree");
    if (typeof opts.worktree === "string" && opts.worktree.trim()) {
      args.push(opts.worktree);
    }
    if (opts.worktreeBase) args.push("--worktree-base", opts.worktreeBase);
  }
  if (opts.sandbox) args.push("--sandbox", opts.sandbox);
  if (opts.force) args.push("--force");
  if (opts.extraArgs?.length) args.push(...opts.extraArgs);
  args.push(prompt);

  const timeoutMs = opts.timeoutMs ?? 600_000;

  return new Promise<CursorRunResult>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const proc = spawn(command, args, {
      cwd: opts.workspace ?? process.cwd(),
      shell: process.platform === "win32",
      env: { ...process.env },
    });
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(`cursor-agent timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      opts.onToken?.(text);
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      const parsed = parseResult(stdout);
      if (parsed) {
        resolve(parsed);
        return;
      }
      if (code !== 0) {
        reject(
          new Error(stderr.trim() || `cursor-agent exited with code ${code}`)
        );
        return;
      }
      resolve({ text: stdout.trim(), isError: false });
    });
  });
}

export class CursorBackend implements AgentBackend {
  async run(req: AgentRunRequest): Promise<string> {
    const cfg = (req.agent.config ?? {}) as AgentCursorConfig;
    const userMsg =
      req.messages.filter((m) => m.role === "user").pop()?.content ??
      req.messages.filter((m) => m.role === "system").pop()?.content ??
      "";
    const bundled = buildContractorContextBundle(req.toolCtx.db, userMsg);
    const res = await runCursorAgent({
      prompt: bundled,
      model: cfg.model,
      workspace: cfg.workspace ?? config.repoRoot,
      // Default to an isolated git worktree so a dispatched agent never mutates
      // the live working tree unless explicitly configured otherwise.
      worktree: cfg.worktree ?? true,
      worktreeBase: cfg.worktreeBase,
      sandbox: cfg.sandbox,
      force: cfg.force,
      mode: cfg.mode,
      timeoutMs: cfg.timeoutMs,
      command: cfg.command,
      extraArgs: cfg.args,
      onToken: req.onToken,
    });
    if (res.isError) {
      throw new Error(res.text || "cursor-agent reported an error");
    }
    return res.text;
  }
}
