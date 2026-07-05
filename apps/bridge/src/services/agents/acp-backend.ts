import { spawn } from "node:child_process";
import readline from "node:readline";
import type { AgentBackend, AgentRunRequest } from "./backend.js";
import type { AgentAcpConfig } from "./types.js";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: { message?: string };
  method?: string;
  params?: Record<string, unknown>;
}

export class AcpBackend implements AgentBackend {
  async run(req: AgentRunRequest): Promise<string> {
    const cfg = req.agent.config as AgentAcpConfig;
    const prompt =
      req.messages.filter((m) => m.role === "user").pop()?.content?.trim() ?? "";
    if (!prompt) throw new Error("ACP agent requires a user prompt");

    const command = cfg.command ?? "npx";
    const args = cfg.args?.length
      ? cfg.args
      : ["-y", "@anthropic-ai/claude-code", "--acp"];
    const cwd = cfg.cwd ?? process.cwd();
    const timeoutMs = cfg.timeoutMs ?? 300_000;

    return new Promise((resolve, reject) => {
      let nextId = 1;
      const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
      let sessionId: string | null = null;
      let answer = "";

      const proc = spawn(command, args, {
        cwd,
        shell: process.platform === "win32",
        stdio: ["pipe", "pipe", "pipe"],
      });

      const timer = setTimeout(() => {
        proc.kill("SIGTERM");
        reject(new Error(`ACP agent timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const send = (method: string, params?: Record<string, unknown>) => {
        const id = nextId++;
        const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
        proc.stdin?.write(JSON.stringify(msg) + "\n");
        return new Promise<unknown>((res, rej) => {
          pending.set(id, { resolve: res, reject: rej });
        });
      };

      const rl = readline.createInterface({ input: proc.stdout! });
      rl.on("line", (line) => {
        try {
          const msg = JSON.parse(line) as JsonRpcResponse;
          if (msg.method === "session/update") {
            const update = msg.params as {
              update?: { sessionUpdate?: string; content?: { text?: string } };
            };
            const text = update?.update?.content?.text;
            if (text) {
              answer += text;
              req.onToken?.(text);
            }
            return;
          }
          if (msg.id != null && pending.has(msg.id)) {
            const p = pending.get(msg.id)!;
            pending.delete(msg.id);
            if (msg.error) p.reject(new Error(msg.error.message ?? "ACP error"));
            else p.resolve(msg.result);
          }
        } catch {
          /* ignore non-json lines */
        }
      });

      proc.stderr?.on("data", () => undefined);
      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });

      void (async () => {
        try {
          await send("initialize", {
            protocolVersion: 1,
            clientCapabilities: {},
            clientInfo: { name: "intelligence", version: "1.0" },
          });
          const session = (await send("session/new", {})) as { sessionId?: string };
          sessionId = session.sessionId ?? (session as { id?: string }).id ?? null;
          if (!sessionId) throw new Error("ACP session/new did not return sessionId");

          await send("session/prompt", {
            sessionId,
            prompt: [{ type: "text", text: prompt }],
          });

          clearTimeout(timer);
          proc.kill("SIGTERM");
          resolve(answer.trim() || "(no ACP response)");
        } catch (err) {
          clearTimeout(timer);
          proc.kill("SIGTERM");
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      })();
    });
  }
}
