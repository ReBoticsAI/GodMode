import type { CoreDatabase } from "../core-db.js";
import type { LlmManager } from "./llm-manager.js";
import { getTenantDb } from "../tenant-registry.js";
import { getAgent } from "./agents/agents-db.js";
import { resolveAgent, getBackend } from "./agents/registry.js";
import { assemblePrompt, loadPromptFlowConfig } from "./prompt-assembler.js";
import type { AgentMessage } from "./ai-agent.js";
import {
  createAgentMessage,
  listConversationAgents,
  listMessages,
  listConversationMemberUserIds,
  type DmAgentMemberInput,
} from "./dm-service.js";
import { getShareBroker } from "../ws-broker.js";

export interface AgentResponseDeps {
  llm: LlmManager;
  bridgePort: number;
}

interface AgentTarget extends DmAgentMemberInput {
  name: string;
  autoRespondInGroups: boolean;
}

function parseThinking(content: string): { thinking: string | null; answer: string } {
  const thinkMatch = content.match(/<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/i);
  if (thinkMatch) {
    return {
      thinking: thinkMatch[1].trim(),
      answer: content.replace(thinkMatch[0], "").trim(),
    };
  }
  return { thinking: null, answer: content };
}

function agentAutoRespond(agent: { config: Record<string, unknown> }): boolean {
  return agent.config.autoRespondInGroups === true;
}

/** Find agent participants @mentioned in message text (by id or display name). */
export function findMentionedAgents(
  text: string,
  agents: AgentTarget[]
): AgentTarget[] {
  const lower = text.toLowerCase();
  const mentioned = new Set<string>();
  for (const agent of agents) {
    const idPat = `@${agent.agentId.toLowerCase()}`;
    const nameCompact = `@${agent.name.toLowerCase().replace(/\s+/g, "")}`;
    const nameSpaced = `@${agent.name.toLowerCase()}`;
    if (
      lower.includes(idPat) ||
      lower.includes(nameCompact) ||
      lower.includes(nameSpaced)
    ) {
      mentioned.add(`${agent.agentTenantId}:${agent.agentId}`);
    }
  }
  return agents.filter((a) => mentioned.has(`${a.agentTenantId}:${a.agentId}`));
}

async function cheapCompletion(
  llm: LlmManager,
  messages: Array<{ role: string; content: string }>,
  maxTokens = 8
): Promise<string> {
  if (!llm.isReady()) return "no";
  const baseUrl = llm.getServerBaseUrl();
  const sampling = llm.getSamplingParams();
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "default",
      messages,
      stream: false,
      temperature: 0,
      max_tokens: maxTokens,
      top_p: sampling.topP,
    }),
  });
  if (!res.ok) return "no";
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content?.trim() ?? "no";
}

/** Lightweight relevance gate before a full group reply. */
export async function checkAgentRelevance(
  llm: LlmManager,
  agentTenantId: string,
  agentId: string,
  messageText: string
): Promise<boolean> {
  const agent = getAgent(getTenantDb(agentTenantId), agentId);
  if (!agent) return false;
  const roleHint = agent.description?.trim() || agent.systemPrompt.slice(0, 400);
  const answer = await cheapCompletion(llm, [
    {
      role: "system",
      content:
        `You are "${agent.name}". Role: ${roleHint}\n` +
        `Reply with ONLY "yes" or "no": should you respond to this group message?`,
    },
    { role: "user", content: messageText },
  ]);
  return /^yes\b/i.test(answer);
}

function resolveAgentTargets(
  core: CoreDatabase,
  conversationId: string
): AgentTarget[] {
  return listConversationAgents(core, conversationId)
    .map((a) => {
      const agent = getAgent(getTenantDb(a.agentTenantId), a.agentId);
      if (!agent) return null;
      return {
        ...a,
        name: agent.name,
        autoRespondInGroups: agentAutoRespond(agent),
      };
    })
    .filter(Boolean) as AgentTarget[];
}

function buildConversationHistory(
  core: CoreDatabase,
  conversationId: string,
  viewerUserId: string,
  limit = 30
): string {
  const msgs = listMessages(core, conversationId, viewerUserId, { limit });
  return msgs
    .map((m) => {
      const who =
        m.senderKind === "agent"
          ? m.senderAgent?.name ?? m.senderAgentId ?? "Agent"
          : m.sender?.displayName ?? "User";
      return `${who}: ${m.bodyText}`;
    })
    .join("\n");
}

async function generateAgentReply(
  deps: AgentResponseDeps,
  opts: {
    core: CoreDatabase;
    agentTenantId: string;
    agentId: string;
    conversationId: string;
    triggerMessage: string;
    senderDisplayName: string;
    viewerUserId: string;
    tenantId: string;
  }
): Promise<string> {
  const engineDb = getTenantDb(opts.agentTenantId);
  const agent = resolveAgent(engineDb, opts.agentId);
  const flowConfig = loadPromptFlowConfig(engineDb);
  const transcript = buildConversationHistory(
    opts.core,
    opts.conversationId,
    opts.viewerUserId
  );

  const assembled = assemblePrompt(engineDb, {
    basePrompt: agent.systemPrompt,
    flowConfig,
    enableThinking: agent.thinking.enableThinking,
    thinkingEfficiency: agent.thinking.thinkingEfficiency,
    nativeTools: false,
    agentId: agent.id,
    tenantId: opts.tenantId,
    agent,
    userPreview: opts.triggerMessage,
  });

  const groupContext =
    `You are participating in a group conversation. ` +
    `Reply concisely as ${agent.name}. Address the humans naturally.\n\n` +
    (transcript ? `Recent messages:\n${transcript}\n\n` : "") +
    `${opts.senderDisplayName}: ${opts.triggerMessage}`;

  const messages: AgentMessage[] = [
    { role: "system", content: assembled.systemPrompt },
    { role: "user", content: groupContext },
  ];

  const backend = getBackend(agent, engineDb, deps.llm);
  const raw = await backend.run({
    agent,
    messages,
    toolSchemas: [],
    toolCtx: {
      db: engineDb,
      chatId: undefined,
      bridgePort: deps.bridgePort,
      llm: deps.llm,
      activeAgentId: agent.id,
      userId: opts.viewerUserId,
      tenantId: opts.tenantId,
    },
  });

  const { answer } = parseThinking(raw);
  return answer || raw;
}

/** Decide which agents should reply to a new human message in a mixed conversation. */
export async function selectRespondingAgents(
  deps: AgentResponseDeps,
  core: CoreDatabase,
  conversationId: string,
  messageText: string
): Promise<AgentTarget[]> {
  const agents = resolveAgentTargets(core, conversationId);
  if (agents.length === 0) return [];

  const mentioned = findMentionedAgents(messageText, agents);
  const mentionedIds = new Set(
    mentioned.map((a) => `${a.agentTenantId}:${a.agentId}`)
  );

  const responding: AgentTarget[] = [...mentioned];

  for (const agent of agents) {
    const key = `${agent.agentTenantId}:${agent.agentId}`;
    if (mentionedIds.has(key)) continue;
    if (!agent.autoRespondInGroups) continue;
    const relevant = await checkAgentRelevance(
      deps.llm,
      agent.agentTenantId,
      agent.agentId,
      messageText
    );
    if (relevant) responding.push(agent);
  }

  const seen = new Set<string>();
  return responding.filter((a) => {
    const key = `${a.agentTenantId}:${a.agentId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * After a human posts in a mixed conversation, invoke eligible agents and post
 * their replies into the same thread. Runs asynchronously; errors are logged.
 */
export function scheduleAgentResponses(
  deps: AgentResponseDeps,
  opts: {
    core: CoreDatabase;
    conversationId: string;
    messageText: string;
    senderUserId: string;
    senderDisplayName: string;
    tenantId: string;
  }
): void {
  void (async () => {
    if (!deps.llm.isReady()) return;

    const targets = await selectRespondingAgents(
      deps,
      opts.core,
      opts.conversationId,
      opts.messageText
    );
    if (targets.length === 0) return;

    const memberIds = listConversationMemberUserIds(opts.core, opts.conversationId);

    for (const target of targets) {
      try {
        const replyText = await generateAgentReply(deps, {
          core: opts.core,
          agentTenantId: target.agentTenantId,
          agentId: target.agentId,
          conversationId: opts.conversationId,
          triggerMessage: opts.messageText,
          senderDisplayName: opts.senderDisplayName,
          viewerUserId: opts.senderUserId,
          tenantId: opts.tenantId,
        });
        if (!replyText.trim()) continue;

        const message = createAgentMessage(opts.core, {
          conversationId: opts.conversationId,
          agentId: target.agentId,
          agentTenantId: target.agentTenantId,
          bodyText: replyText.trim(),
        });

        const payload = {
          type: "dm_message",
          data: { message, conversationId: opts.conversationId },
          timestamp: Date.now(),
        };
        getShareBroker().broadcastResource(
          "conversation",
          opts.conversationId,
          payload
        );
        for (const userId of memberIds) {
          getShareBroker().broadcastToRoom(`user:${userId}`, payload);
        }
      } catch (err) {
        console.error(
          `[dm] agent reply failed (${target.agentId}):`,
          err instanceof Error ? err.message : err
        );
      }
    }
  })();
}
