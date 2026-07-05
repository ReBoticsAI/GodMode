import { createHash } from "node:crypto";
import type { AppDatabase } from "../../db.js";
import { config } from "../../config.js";
import type { AgentBackend, AgentRunRequest } from "./backend.js";
import type { AgentCursorCloudConfig } from "./types.js";
import { getToolSchemasForLlm } from "../ai-tools-registry.js";
import { executeTool, type ToolExecContext } from "../ai-tool-executor.js";
import { shouldAutoApproveTool } from "../confirm-policy.js";
import { resolveCursorApiKey } from "../cursor-subscription.js";
import type { IntelligenceChatMode } from "../chat-mode.js";

type SdkAgent = Awaited<
  ReturnType<(typeof import("@cursor/sdk"))["Agent"]["create"]>
>;

interface ChatAgentEntry {
  agent: SdkAgent;
  systemHash: string;
}

const chatAgents = new Map<string, ChatAgentEntry>();

function filterSchemas(
  allow: string[] | null,
  agentId: string,
  db: AppDatabase,
  chatMode?: IntelligenceChatMode
) {
  const all = getToolSchemasForLlm(db, agentId, chatMode);
  if (!allow?.length) return all;
  if (allow.includes("*")) return all;
  const set = new Set(allow);
  return all.filter((t) => set.has(t.function.name));
}

function buildPrompt(req: AgentRunRequest): string {
  const system = req.messages.find((m) => m.role === "system")?.content?.trim() ?? "";
  const lastUser =
    [...req.messages].reverse().find((m) => m.role === "user")?.content?.trim() ?? "";
  if (!lastUser) throw new Error("User message required");
  if (!system) return lastUser;
  return `<!-- godmode-system -->\n${system}\n<!-- /godmode-system -->\n\n${lastUser}`;
}

function systemHash(system: string): string {
  return createHash("sha256").update(system).digest("hex").slice(0, 16);
}

function buildCustomTools(
  req: AgentRunRequest,
  db: AppDatabase,
  toolCtx: ToolExecContext,
  chatMode?: IntelligenceChatMode
): Record<string, import("@cursor/sdk").SDKCustomTool> {
  const schemas =
    req.toolSchemas ?? filterSchemas(req.agent.toolAllow, req.agent.id, db, chatMode);
  const tools: Record<string, import("@cursor/sdk").SDKCustomTool> = {};
  for (const schema of schemas) {
    const name = schema.function.name;
    tools[name] = {
      description: schema.function.description,
      inputSchema: (schema.function.parameters ?? {
        type: "object",
        properties: {},
      }) as Record<string, import("@cursor/sdk").SDKJsonValue>,
      execute: async (args, context) => {
        req.onToolCall?.(name, args as Record<string, unknown>, context.toolCallId);
        const approved = await shouldAutoApproveTool(
          req.agent,
          name,
          req.onConfirmRequired,
          {
            toolCallId: context.toolCallId ?? name,
            name,
            args: args as Record<string, unknown>,
          },
          toolCtx.sessionAutonomy
        );
        if (!approved) {
          const declined = { error: "User declined tool execution" };
          req.onToolResult?.(name, declined, context.toolCallId, true);
          return { content: [{ type: "text", text: JSON.stringify(declined) }], isError: true };
        }
        try {
          const result = await executeTool(name, args as Record<string, unknown>, {
            ...toolCtx,
            activeToolCallId: context.toolCallId,
            onTerminalOutput: req.onTerminalOutput
              ? (chunk) =>
                  req.onTerminalOutput!(context.toolCallId ?? name, chunk)
              : toolCtx.onTerminalOutput,
          });
          req.onToolResult?.(name, result, context.toolCallId, false);
          if (typeof result === "string") return result;
          return JSON.stringify(result);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const payload = { error: message };
          req.onToolResult?.(name, payload, context.toolCallId, true);
          return { content: [{ type: "text", text: message }], isError: true };
        }
      },
    };
  }
  return tools;
}

async function getOrCreateChatAgent(
  chatKey: string,
  apiKey: string,
  cfg: AgentCursorCloudConfig,
  cwd: string,
  hash: string
): Promise<SdkAgent> {
  const existing = chatAgents.get(chatKey);
  if (existing && existing.systemHash === hash) return existing.agent;
  if (existing) {
    chatAgents.delete(chatKey);
  }
  const { Agent } = await import("@cursor/sdk");
  const agent = await Agent.create({
    apiKey,
    agentId: chatKey,
    model: { id: cfg.model?.trim() || "auto" },
    local: {
      cwd,
      sandboxOptions: { enabled: false },
    },
  });
  chatAgents.set(chatKey, { agent, systemHash: hash });
  return agent;
}

/**
 * Runs Intelligence on Cursor subscription models via @cursor/sdk.
 * GodMode tools are exposed as SDK customTools — same tool loop, Cursor-hosted models.
 */
export class CursorCloudBackend implements AgentBackend {
  constructor(private db: AppDatabase) {}

  async run(req: AgentRunRequest): Promise<string> {
    const apiKey = resolveCursorApiKey(this.db);
    if (!apiKey) {
      throw new Error(
        "Cursor not connected. Add your API key in Vault → Cursor subscription."
      );
    }

    const cfg = (req.agent.config ?? {}) as AgentCursorCloudConfig;
    const cwd = cfg.workspace?.trim() || config.repoRoot;
    const chatKey = `godmode-${req.toolCtx.chatId ?? req.agent.id}`;
    const chatMode = req.chatMode ?? "agent";
    const toolCtx: ToolExecContext = {
      ...req.toolCtx,
      delegationDepth: req.delegationDepth ?? 0,
    };
    const customTools = buildCustomTools(req, this.db, toolCtx, chatMode);
    const prompt = buildPrompt(req);
    const sys = req.messages.find((m) => m.role === "system")?.content ?? "";
    const hash = systemHash(sys);

    const sdkAgent = await getOrCreateChatAgent(chatKey, apiKey, cfg, cwd, hash);
    const run = await sdkAgent.send(prompt, { local: { customTools } });

    let streamed = "";
    for await (const event of run.stream()) {
      if (req.abortSignal?.aborted) {
        await run.cancel();
        throw new DOMException("Aborted", "AbortError");
      }
      if (event.type === "assistant") {
        for (const block of event.message.content) {
          if (block.type === "text" && block.text) {
            streamed += block.text;
            req.onToken?.(block.text);
          }
        }
      } else if (event.type === "thinking" && event.text) {
        req.onReasoning?.(event.text);
      }
    }

    const result = await run.wait();
    if (result.status === "error") {
      throw new Error(result.result || "Cursor agent run failed");
    }

    const usageRaw = (result as { usage?: Record<string, number> }).usage;
    if (usageRaw && req.onUsage) {
      req.onUsage({
        prompt_tokens: Number(usageRaw.inputTokens ?? usageRaw.prompt_tokens ?? 0),
        completion_tokens: Number(
          usageRaw.outputTokens ?? usageRaw.completion_tokens ?? 0
        ),
        total_tokens: Number(
          usageRaw.totalTokens ??
            usageRaw.total_tokens ??
            (Number(usageRaw.inputTokens ?? 0) + Number(usageRaw.outputTokens ?? 0))
        ),
      });
    }

    return result.result?.trim() || streamed.trim();
  }
}

/** Whether this agent backend requires a running local llama-server. */
export function agentNeedsLocalLlm(backend: string): boolean {
  return backend === "local" || backend === "remote";
}

/** Whether chat can proceed without local llama (cloud / cursor backends). */
export function agentCanRunWithoutLocalLlm(
  backend: string,
  db: AppDatabase
): boolean {
  if (backend === "cursor_cloud") return resolveCursorApiKey(db) != null;
  if (backend === "provider" || backend === "cli" || backend === "acp" || backend === "cursor") {
    return true;
  }
  return false;
}
