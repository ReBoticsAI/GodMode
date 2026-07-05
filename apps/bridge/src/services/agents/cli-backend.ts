import { spawn } from "node:child_process";
import type { AgentBackend, AgentRunRequest } from "./backend.js";
import type { AgentCliConfig } from "./types.js";

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? "");
}

export class CliBackend implements AgentBackend {
  async run(req: AgentRunRequest): Promise<string> {
    const cfg = req.agent.config as AgentCliConfig;
    const userMsg =
      req.messages.filter((m) => m.role === "user").pop()?.content ??
      req.messages.filter((m) => m.role === "system").pop()?.content ??
      "";
    const prompt = userMsg.trim();
    if (!prompt) throw new Error("CLI agent requires a user prompt");

    const command =
      cfg.command ??
      (req.agent.name.toLowerCase().includes("opencode") ? "opencode" : "claude");
    const defaultArgs =
      command === "opencode"
        ? ["run", "{{prompt}}"]
        : ["-p", "{{prompt}}", "--output-format", "text"];
    const argsTemplate = cfg.args?.length ? cfg.args : defaultArgs;
    const vars = { prompt, input: prompt };
    const args = argsTemplate.map((a) => interpolate(a, vars));
    const cwd = cfg.cwd ?? process.cwd();
    const timeoutMs = cfg.timeoutMs ?? 300_000;

    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      const proc = spawn(command, args, {
        cwd,
        shell: process.platform === "win32",
        env: { ...process.env },
      });
      const timer = setTimeout(() => {
        proc.kill("SIGTERM");
        reject(new Error(`CLI agent timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      proc.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        req.onToken?.(text);
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
        if (code !== 0 && !stdout.trim()) {
          reject(new Error(stderr || `CLI exited with code ${code}`));
          return;
        }
        resolve(stdout.trim() || stderr.trim());
      });
    });
  }
}
