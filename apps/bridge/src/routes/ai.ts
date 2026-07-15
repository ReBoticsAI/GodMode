import { Router, type Request, type Response } from "express";
import { v4 as uuidv4 } from "uuid";
import type { EventEmitter } from "node:events";
import { config } from "../config.js";
import { requireEditorForMutation } from "../services/auth/middleware.js";
import type { AppDatabase } from "../db.js";
import type { LlmManager } from "../services/llm-manager.js";
import { AI_CHAT_COMMANDS } from "../services/ai-commands-registry.js";
import {
  loadPromptFlowConfig,
  savePromptFlowConfig,
  assemblePrompt,
  getSemanticMemoriesText,
  type PromptFlowConfig,
} from "../services/prompt-assembler.js";
import { getCapabilitiesText } from "../services/capability-rag.js";
import {
  indexMemory,
  removeMemoryFromIndex,
} from "../services/embeddings/memory-embeddings.js";
import {
  countCapabilityIndex,
  rebuildAllAgentCapabilityIndexes,
} from "../services/capability-index.js";
import {
  listAiRules,
  updateAiRuleState,
  setAiRuleStatus,
  deleteRuleFile,
} from "../services/ai-rules.js";
import {
  listAiSkills,
  loadSkillBody,
  updateAiSkillState,
  setAiSkillStatus,
  deleteSkillFile,
} from "../services/ai-skills.js";
import {
  listArtifacts,
  getArtifact,
  readArtifact,
  saveArtifact,
  deleteArtifact,
} from "../services/ai-artifacts.js";
import { AI_TOOL_REGISTRY, listVisibleTools } from "../services/ai-tools-registry.js";
import { normalizeTodoItems } from "../services/ai-tool-executor.js";
import { reconcileParentProgress } from "../services/card-progress.js";
import { NEVER_AUTO_APPROVE } from "../services/confirm-policy.js";
import {
  runAgentChat,
  resolveToolConfirmation,
  waitForToolConfirmation,
  type AgentMessage,
} from "../services/ai-agent.js";
import {
  compactAgentMessages,
  historyToAgentMessages,
  HISTORY_CHAR_BUDGET_RATIO,
  type HistoryTurn,
} from "../services/chat-history.js";
import {
  createSchedule,
  deleteSchedule,
  listSchedules,
  updateSchedule,
  type AiScheduler,
} from "../services/ai-scheduler.js";
import {
  createWorkflow,
  listWorkflows,
  updateWorkflow,
  type AiWorkflow,
} from "../services/ai-workflows.js";
import type { AiQueueWorker } from "../services/ai-queue-worker.js";
import { AUTONOMOUS_RUNNER_ID } from "../services/ai-queue-worker.js";
import type { AiTrainingManager } from "../services/ai-training-manager.js";
import type { EmbeddingManager } from "../services/embeddings/embedding-manager.js";
import type { ReflectionService } from "../services/reflection-service.js";
import type { MemoryMaintenanceService } from "../services/memory-maintenance.js";
import { getHybridWikiText } from "../services/wiki-rag.js";
import {
  approveWikiProposal,
  listWikiProposals,
  rejectWikiProposal,
} from "../services/wiki-proposals.js";
import {
  getReflectionConfig,
  patchReflectionConfig,
} from "../services/reflection-config.js";
import {
  approveReflectionProposal,
  listReflectionProposals,
  rejectReflectionProposal,
} from "../services/reflection-proposals.js";
import {
  AiDatasetBuilder,
  type DatasetSource,
} from "../services/ai-dataset-builder.js";
import {
  listAgents,
  getAgent,
  createAgent,
  updateAgent,
  deleteAgent,
  listSecrets,
  createSecret,
  deleteSecret,
} from "../services/agents/agents-db.js";
import {
  listAgentAccounts,
  createAgentApiKeyAccount,
  revokeAgentAccount,
} from "../services/agents/agent-accounts.js";
import { resolveAgent, getBackend } from "../services/agents/registry.js";
import { agentCanRunWithoutLocalLlm } from "../services/agents/cursor-cloud-backend.js";
import {
  getCursorAuthStatus,
  upsertCursorApiKey,
  removeCursorApiKey,
  listCursorSubscriptionModels,
  probeCursorCliAuth,
  startCursorCliLoginUrl,
  normalizeCursorVaultSecret,
} from "../services/cursor-subscription.js";
import { markLlmReady } from "../services/onboarding.js";
import { listModelCatalog, selectIntelligenceModel } from "../services/model-catalog.js";
import {
  applyProfileSampling,
  filterSchemasForProfile,
  resolveProfileForAgent,
} from "../services/model-profiles/index.js";
import { getToolSchemasForLlm } from "../services/ai-tools-registry.js";
import { globFiles, listDir } from "../services/coding/fs-tools.js";
import type { IntelligenceChatMode } from "../services/chat-mode.js";
import type { CodeAutonomyLevel } from "../services/agents/agents-db.js";
import {
  listAssignments,
  setAssignment,
  resolveAgentForPage,
  isAssignmentScopeType,
  AssignmentError,
} from "../services/ai-agent-assignments.js";
import { listPlatformActions } from "../services/platform-scope.js";
import {
  getCoreDb,
  createSharedChatSession,
  getSharedChatSession,
  listSharedChatSessionsForUser,
  type CoreSharedChatSession,
  type ShareGrantRole,
} from "../core-db.js";
import { resolveShareAccess } from "../services/share-service.js";
import { refreshScheduler } from "../services/scheduler.js";
import { getTenantDb } from "../tenant-registry.js";
import { getShareBroker, broadcastCardActivity } from "../ws-broker.js";

export type { PlatformContext } from "../types/platform-context.js";
import type { PlatformContext } from "../types/platform-context.js";

interface ChatMessagePart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ChatMessagePart[];
  tool_calls?: AgentMessage["tool_calls"];
  tool_call_id?: string;
  name?: string;
}

function parseThinking(content: string): { thinking: string | null; answer: string } {
  let working = content;

  // Gemma 4 native thought channel: <|channel>thought\n...\n<channel|>
  const channelRe = /<\|channel>thought\n([\s\S]*?)<channel\|>/g;
  const channelThoughts: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = channelRe.exec(content)) !== null) {
    channelThoughts.push(m[1].trim());
  }
  if (channelThoughts.length > 0) {
    working = working.replace(channelRe, "").trim();
    return { thinking: channelThoughts.join("\n\n"), answer: working };
  }

  // Strip Gemma think token prefix if present in output
  working = working.replace(/^<\|think\>\s*/i, "").trim();

  const thinkMatch = working.match(/<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/i);
  const redactedMatch = working.match(/([\s\S]*?)<\/redacted_thinking>/i);
  const match = thinkMatch ?? redactedMatch;
  if (match) {
    const thinking = match[1].trim();
    const answer = working.replace(match[0], "").trim();
    return { thinking, answer };
  }
  return { thinking: null, answer: working };
}

export interface AiRouterDeps {
  queue: AiQueueWorker;
  training: AiTrainingManager;
  scheduler: AiScheduler;
  bridgePort: number;
  embeddings?: EmbeddingManager;
  reflection?: ReflectionService;
  memoryMaintenance?: MemoryMaintenanceService;
  bus?: EventEmitter;
}

export function createAiRouter(
  operatorDb: AppDatabase,
  llm: LlmManager,
  deps: AiRouterDeps
): Router {
  const router = Router();
  const tdb = (req: Request): AppDatabase => {
    if (req.tenantDb) return req.tenantDb;
    if (!config.isProduction) return operatorDb;
    throw new Error("Tenant context required");
  };
  router.use(requireEditorForMutation);
  const { training, scheduler, bridgePort, queue, embeddings, reflection, memoryMaintenance, bus } =
    deps;
  const datasetBuilderFor = (req: Request) => new AiDatasetBuilder(tdb(req));

  type AgentScope = {
    db: AppDatabase;
    tenantId: string;
    owned: boolean;
    role: ShareGrantRole;
  };

  function resolveAgentScope(
    req: Request,
    agentId: string,
    minRole: ShareGrantRole = "viewer"
  ): AgentScope | null {
    const own = tdb(req);
    if (getAgent(own, agentId)) {
      return { db: own, tenantId: req.tenantId!, owned: true, role: "owner" };
    }
    const userId = req.user?.id;
    const tenantId = req.tenantId;
    if (!userId || !tenantId) return null;
    const access = resolveShareAccess(getCoreDb(), {
      userId,
      tenantId,
      resourceKind: "agent",
      resourceId: agentId,
      minRole,
    });
    if (!access) return null;
    return {
      db: access.db,
      tenantId: access.ownerTenantId,
      owned: false,
      role: access.role,
    };
  }

  function agentDbFromRequest(
    req: Request,
    res: Response,
    agentId: string,
    minRole: ShareGrantRole = "viewer"
  ): AppDatabase | null {
    const scope = resolveAgentScope(req, agentId, minRole);
    if (!scope) {
      res.status(404).json({ error: "Agent not found" });
      return null;
    }
    return scope.db;
  }

  function agentIdFromRequest(req: Request): string {
    const body = req.body as { agentId?: string } | undefined;
    return String(req.query.agentId ?? body?.agentId ?? "intelligence");
  }

  /**
   * Where a chat's messages/artifacts physically live ("Engine vs Work").
   * Chats are the ACTOR's work, so by default they live in the actor's own
   * tenant DB. A chat promoted to a collaborative "shared session" instead lives
   * in the INITIATOR's tenant DB (the session's home), and every participant
   * routes there. `shared` is the cross-tenant access flag for share grants on
   * the agent itself (used purely for broadcast metadata).
   */
  type ChatWorkScope = {
    db: AppDatabase;
    tenantId: string;
    session: CoreSharedChatSession | null;
  };

  function canAccessSharedSession(
    req: Request,
    session: CoreSharedChatSession
  ): boolean {
    // The initiator / any member of the home tenant can always route there.
    if (req.tenantId === session.home_tenant_id) return true;
    const userId = req.user?.id;
    const tenantId = req.tenantId;
    if (!userId || !tenantId) return false;
    // The agent owner (agent lives in their own tenant DB) may join.
    if (getAgent(tdb(req), session.agent_id)) return true;
    // Any grantee with at least viewer access on the agent may join.
    return Boolean(
      resolveShareAccess(getCoreDb(), {
        userId,
        tenantId,
        resourceKind: "agent",
        resourceId: session.agent_id,
        minRole: "viewer",
      })
    );
  }

  /**
   * Resolve the work DB for a chat: the shared-session home DB when the chat is
   * a shared session the caller may access, else the actor's own tenant DB.
   */
  function resolveChatWorkScope(req: Request, chatId?: string | null): ChatWorkScope {
    const ownDb = tdb(req);
    const ownTenant = req.tenantId!;
    if (chatId) {
      const session = getSharedChatSession(getCoreDb(), chatId);
      if (session && canAccessSharedSession(req, session)) {
        return {
          db: getTenantDb(session.home_tenant_id),
          tenantId: session.home_tenant_id,
          session,
        };
      }
    }
    return { db: ownDb, tenantId: ownTenant, session: null };
  }

  // Broadcast a chat/agent event to the agent's shared room (cross-tenant
  // collaborators) AND to the originating tenant's room so the acting user's
  // OTHER devices in the same workspace get near-real-time updates.
  function broadcastAgentEvent(
    agentId: string,
    type: string,
    data: unknown,
    tenantId?: string
  ): void {
    const payload = { type, data, timestamp: Date.now() };
    getShareBroker().broadcastResource("agent", agentId, payload);
    if (tenantId) {
      getShareBroker().broadcastTenant(tenantId, payload);
    }
  }

  // --- Embedding engine (CPU embedder llama-server powering semantic RAG) ---
  router.get("/embeddings/status", (req, res) => {
    if (!embeddings) {
      res.json({ enabled: false, enabledOverride: null, embedder: null });
      return;
    }
    res.json(embeddings.getStatus());
  });

  router.post("/embeddings/start", async (req, res) => {
    if (!embeddings) {
      res.status(503).json({ error: "Embedding engine not available" });
      return;
    }
    try {
      res.json(await embeddings.start());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/embeddings/stop", async (req, res) => {
    if (!embeddings) {
      res.status(503).json({ error: "Embedding engine not available" });
      return;
    }
    try {
      res.json(await embeddings.stop());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Persisted master enable toggle. Survives a bridge restart and reconciles
  // the embedder server (enabling starts it; disabling stops it).
  router.post("/embeddings/enabled", async (req, res) => {
    if (!embeddings) {
      res.status(503).json({ error: "Embedding engine not available" });
      return;
    }
    const enabled = Boolean(req.body?.enabled);
    try {
      res.json(await embeddings.setEnabled(enabled));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/capabilities/rebuild", async (req, res) => {
    try {
      const embedder = embeddings?.getEmbeddingClient();
      const count = await rebuildAllAgentCapabilityIndexes(tdb(req), embedder);
      res.json({ ok: true, count, indexRows: countCapabilityIndex(tdb(req)) });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get("/capabilities/status", (req, res) => {
    try {
      res.json({ indexRows: countCapabilityIndex(tdb(req)) });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Oversight summary: pending review queue + how ready RAG is. Every query is
  // wrapped defensively and defaults to zeros so a partial schema never 500s.
  router.get("/embeddings/activity", (req, res) => {
    const count = (sql: string, ...params: unknown[]): number => {
      try {
        const row = tdb(req).prepare(sql).get(...params) as { n: number } | undefined;
        return row?.n ?? 0;
      } catch {
        return 0;
      }
    };
    const pendingSkills = count(
      `SELECT COUNT(*) AS n FROM ai_agent_skill_state WHERE status = 'pending'`
    );
    const pendingRules = count(
      `SELECT COUNT(*) AS n FROM ai_agent_rule_state WHERE status = 'pending'`
    );
    const pendingMemories = count(
      `SELECT COUNT(*) AS n FROM ai_memories WHERE status = 'pending'`
    );
    const activeMemories = count(
      `SELECT COUNT(*) AS n FROM ai_memories WHERE status = 'active'`
    );
    const embeddedMemories = count(
      `SELECT COUNT(*) AS n FROM ai_memories WHERE status = 'active' AND embedding IS NOT NULL`
    );
    const ftsIndexed = count(
      `SELECT COUNT(*) AS n FROM ai_memories_fts`
    );
    const pendingEpisodes = count(
      `SELECT COUNT(*) AS n FROM ai_memories WHERE status = 'pending' AND source = 'distill'`
    );
    let pendingWikiProposals = 0;
    try {
      const row = getCoreDb()
        .prepare(
          `SELECT COUNT(*) AS n FROM wiki_page_proposals WHERE status = 'pending'`
        )
        .get() as { n: number } | undefined;
      pendingWikiProposals = row?.n ?? 0;
    } catch {
      pendingWikiProposals = 0;
    }

    const embeddingStatus = embeddings?.getStatus() ?? null;

    res.json({
      enabled: embeddingStatus?.enabled ?? false,
      pending: {
        skills: pendingSkills,
        rules: pendingRules,
        memories: pendingMemories,
        episodes: pendingEpisodes,
        wikiProposals: pendingWikiProposals,
      },
      embeddingCoverage: {
        total: activeMemories,
        embedded: embeddedMemories,
      },
      ftsCoverage: {
        total: activeMemories,
        indexed: ftsIndexed,
      },
      ragTopK: config.embeddings.ragTopK,
      wikiRagTopK: config.embeddings.wikiRagTopK,
      embedderLogTail: embeddingStatus?.embedder.logs.slice(-20) ?? [],
    });
  });

  router.get("/models", (req, res) => {
    res.json({ models: llm.scanModels() });
  });

  router.get("/coding/mention-paths", (req, res) => {
    const q = String(req.query.q ?? "")
      .trim()
      .toLowerCase()
      .replace(/\\/g, "/");
    const limit = Math.min(Number(req.query.limit ?? 40), 80);
    const matches: Array<{ path: string; type: "file" | "dir" }> = [];
    if (!q) {
      const root = listDir({ path: ".", recursive: false });
      for (const e of root.entries.slice(0, limit)) {
        matches.push({
          path: e.name,
          type: e.type === "dir" ? "dir" : "file",
        });
      }
      res.json({ paths: matches });
      return;
    }
    const glob = globFiles({ pattern: `**/*${q}*` });
    for (const p of glob.matches) {
      matches.push({ path: p, type: "file" });
      if (matches.length >= limit) break;
    }
    res.json({ paths: matches });
  });

  router.get("/status", (req, res) => {
    res.json(llm.getStatus());
  });

  router.get("/settings", (req, res) => {
    res.json(llm.getSettings());
  });

  router.put("/settings", (req, res) => {
    res.json(llm.updateSettings(req.body ?? {}));
  });

  // Everything that goes to the model: resolved system prompt template, the
  // sampling params, the launch command, the (empty) tool set, and a snapshot
  // of the last actual request. Lets the UI show "what is sent to the LLM".
  router.get("/inspect", (req, res) => {
    const settings = llm.getSettings();
    const pathname = (req.query.pathname as string) || undefined;
    const agentId = String(req.query.agentId ?? "intelligence");
    const agent = getAgent(tdb(req), agentId);
    const previewCtx: PlatformContext | undefined = pathname
      ? { pathname, breadcrumb: [] }
      : undefined;
    const assembled = assemblePrompt(tdb(req), {
      basePrompt: agent?.systemPrompt ?? settings.systemPrompt,
      platformContext: previewCtx,
      enableThinking: agent?.thinking.enableThinking ?? settings.enableThinking,
      thinkingEfficiency: agent?.thinking.thinkingEfficiency ?? settings.thinkingEfficiency,
      nativeTools: agent?.thinking.nativeTools ?? settings.nativeTools,
      agentId,
      tenantId: req.tenantId,
      agent,
    });
    res.json({
      systemPrompt: assembled.systemPrompt,
      defaultSystemPrompt: llm.getDefaultSystemPrompt(),
      sampling: llm.getSamplingParams(),
      launch: llm.previewLaunchCommand(),
      tools: listVisibleTools(tdb(req), agentId).map((t) => ({
        name: t.name,
        description: t.description,
        mode: t.mode,
      })),
      toolsNote:
        "Read-only tools run automatically; action tools require user confirmation in chat.",
      sections: assembled.sections,
      omitted: assembled.omitted,
      estimatedChars: assembled.estimatedChars,
      lastRequest: llm.getLastRequest(),
    });
  });

  router.get("/prompt-flow", (req, res) => {
    const config = loadPromptFlowConfig(tdb(req));
    const settings = llm.getSettings();
    const agentId = String(req.query.agentId ?? "intelligence");
    const agent = getAgent(tdb(req), agentId);
    const assembled = assemblePrompt(tdb(req), {
      basePrompt: agent?.systemPrompt ?? settings.systemPrompt,
      flowConfig: config,
      enableThinking: agent?.thinking.enableThinking ?? settings.enableThinking,
      thinkingEfficiency: agent?.thinking.thinkingEfficiency ?? settings.thinkingEfficiency,
      nativeTools: agent?.thinking.nativeTools ?? settings.nativeTools,
      agentId,
      tenantId: req.tenantId,
      agent,
    });
    res.json({ config, assembled });
  });

  router.put("/prompt-flow", (req, res) => {
    const config = (req.body?.config ?? req.body) as PromptFlowConfig;
    if (!config?.sections?.length) {
      res.status(400).json({ error: "Invalid prompt flow config" });
      return;
    }
    savePromptFlowConfig(tdb(req), config);
    const settings = llm.getSettings();
    const agentId = String(req.body?.agentId ?? req.query.agentId ?? "intelligence");
    const agent = getAgent(tdb(req), agentId);
    const assembled = assemblePrompt(tdb(req), {
      basePrompt: agent?.systemPrompt ?? settings.systemPrompt,
      flowConfig: config,
      enableThinking: agent?.thinking.enableThinking ?? settings.enableThinking,
      thinkingEfficiency: agent?.thinking.thinkingEfficiency ?? settings.thinkingEfficiency,
      nativeTools: agent?.thinking.nativeTools ?? settings.nativeTools,
      agentId,
      tenantId: req.tenantId,
      agent,
    });
    res.json({ config, assembled });
  });

  router.get("/memories", (req, res) => {
    const chatId = req.query.chatId as string | undefined;
    const status = req.query.status as string | undefined;
    const agentId = agentIdFromRequest(req);
    const agentDb = agentDbFromRequest(req, res, agentId, "viewer");
    if (!agentDb) return;
    // Legacy rows have agent_id NULL → treated as the root 'intelligence' agent.
    const agentClause =
      agentId === "intelligence"
        ? `(agent_id = ? OR agent_id IS NULL)`
        : `agent_id = ?`;
    let sql = `SELECT id, scope, chat_id, agent_id, text, category, source, enabled, status,
               created_at, updated_at, embedding_model, embedding_dim, valid_from, valid_until,
               CASE WHEN embedding IS NOT NULL THEN 1 ELSE 0 END AS has_embedding
               FROM ai_memories WHERE ${agentClause}`;
    const params: string[] = [agentId];
    if (chatId) {
      sql += ` AND (scope = 'global' OR (scope = 'chat' AND chat_id = ?))`;
      params.push(chatId);
    }
    if (status === "active" || status === "pending") {
      sql += ` AND status = ?`;
      params.push(status);
    }
    sql += ` ORDER BY updated_at DESC`;
    const rows = agentDb.prepare(sql).all(...params);
    res.json(rows);
  });

  router.post("/memories/:id/approve", (req, res) => {
    const agentId = agentIdFromRequest(req);
    const agentDb = agentDbFromRequest(req, res, agentId, "editor");
    if (!agentDb) return;
    const result = agentDb
      .prepare(
        `UPDATE ai_memories SET status = 'active', updated_at = datetime('now') WHERE id = ?`
      )
      .run(req.params.id);
    if (result.changes === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const row = agentDb.prepare(`SELECT * FROM ai_memories WHERE id = ?`).get(req.params.id) as
      | { id: string; text: string }
      | undefined;
    if (row) {
      indexMemory(
        agentDb,
        embeddings?.isEmbedderReady() ? embeddings.getEmbeddingClient() : null,
        row.id,
        row.text
      );
    }
    res.json(row);
  });

  router.post("/memories", (req, res) => {
    const id = uuidv4();
    const text = String(req.body?.text ?? "").trim();
    if (!text) {
      res.status(400).json({ error: "text required" });
      return;
    }
    const agentId = agentIdFromRequest(req);
    const agentDb = agentDbFromRequest(req, res, agentId, "editor");
    if (!agentDb) return;
    const scope = req.body?.scope === "chat" ? "chat" : "global";
    const chatId = scope === "chat" ? String(req.body?.chatId ?? "") : null;
    agentDb.prepare(
      `INSERT INTO ai_memories (id, scope, chat_id, agent_id, text, category, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      scope,
      chatId || null,
      agentId,
      text,
      req.body?.category ?? null,
      req.body?.source ?? "manual"
    );
    indexMemory(
      agentDb,
      embeddings?.isEmbedderReady() ? embeddings.getEmbeddingClient() : null,
      id,
      text
    );
    const row = agentDb.prepare(`SELECT * FROM ai_memories WHERE id = ?`).get(id);
    res.status(201).json(row);
  });

  router.put("/memories/:id", (req, res) => {
    const agentId = agentIdFromRequest(req);
    const agentDb = agentDbFromRequest(req, res, agentId, "editor");
    if (!agentDb) return;
    const { text, enabled, category } = req.body ?? {};
    const existing = agentDb
      .prepare(`SELECT id, text FROM ai_memories WHERE id = ?`)
      .get(req.params.id) as { id: string; text: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (text != null) {
      agentDb.prepare(
        `UPDATE ai_memories SET text = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(String(text), req.params.id);
    }
    if (enabled != null) {
      agentDb.prepare(
        `UPDATE ai_memories SET enabled = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(enabled ? 1 : 0, req.params.id);
    }
    if (category != null) {
      agentDb.prepare(
        `UPDATE ai_memories SET category = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(String(category), req.params.id);
    }
    const row = agentDb.prepare(`SELECT * FROM ai_memories WHERE id = ?`).get(req.params.id) as
      | { id: string; text: string }
      | undefined;
    if (row) {
      indexMemory(
        agentDb,
        embeddings?.isEmbedderReady() ? embeddings.getEmbeddingClient() : null,
        row.id,
        row.text
      );
    }
    res.json(row);
  });

  router.delete("/memories/:id", (req, res) => {
    const agentId = agentIdFromRequest(req);
    const agentDb = agentDbFromRequest(req, res, agentId, "editor");
    if (!agentDb) return;
    removeMemoryFromIndex(agentDb, req.params.id);
    const result = agentDb.prepare(`DELETE FROM ai_memories WHERE id = ?`).run(req.params.id);
    res.json({ ok: result.changes > 0 });
  });

  router.get("/rules", (req, res) => {
    const agentId = agentIdFromRequest(req);
    const agentDb = agentDbFromRequest(req, res, agentId, "viewer");
    if (!agentDb) return;
    res.json({ rules: listAiRules(agentDb, agentId) });
  });

  router.put("/rules/:id", (req, res) => {
    const agentId = agentIdFromRequest(req);
    const agentDb = agentDbFromRequest(req, res, agentId, "editor");
    if (!agentDb) return;
    updateAiRuleState(agentDb, agentId, req.params.id, {
      enabled: req.body?.enabled,
      priorityOverride: req.body?.priorityOverride,
    });
    res.json({ rules: listAiRules(agentDb, agentId) });
  });

  // Approve a reflection-drafted (pending) rule → becomes active/applied.
  router.post("/rules/:id/approve", (req, res) => {
    const agentId = agentIdFromRequest(req);
    const agentDb = agentDbFromRequest(req, res, agentId, "editor");
    if (!agentDb) return;
    setAiRuleStatus(agentDb, agentId, req.params.id, "active");
    res.json({ rules: listAiRules(agentDb, agentId) });
  });

  // Reject a pending rule → delete the file and its state.
  router.delete("/rules/:id", (req, res) => {
    const agentId = agentIdFromRequest(req);
    const agentDb = agentDbFromRequest(req, res, agentId, "editor");
    if (!agentDb) return;
    const ok = deleteRuleFile(agentDb, req.params.id);
    res.json({ ok, rules: listAiRules(agentDb, agentId) });
  });

  router.get("/skills", (req, res) => {
    const includeBody = req.query.body === "1";
    const agentId = agentIdFromRequest(req);
    const agentDb = agentDbFromRequest(req, res, agentId, "viewer");
    if (!agentDb) return;
    res.json({ skills: listAiSkills(agentDb, includeBody, agentId) });
  });

  router.get("/skills/:id", (req, res) => {
    const agentId = agentIdFromRequest(req);
    const agentDb = agentDbFromRequest(req, res, agentId, "viewer");
    if (!agentDb) return;
    const body = loadSkillBody(agentDb, req.params.id, agentId);
    if (!body) {
      res.status(404).json({ error: "Skill not found or disabled" });
      return;
    }
    res.json({ id: req.params.id, body });
  });

  router.put("/skills/:id", (req, res) => {
    if (req.body?.enabled == null) {
      res.status(400).json({ error: "enabled required" });
      return;
    }
    const agentId = agentIdFromRequest(req);
    const agentDb = agentDbFromRequest(req, res, agentId, "editor");
    if (!agentDb) return;
    updateAiSkillState(agentDb, agentId, req.params.id, Boolean(req.body.enabled));
    res.json({ skills: listAiSkills(agentDb, false, agentId) });
  });

  // Approve a reflection-drafted (pending) skill → becomes injectable.
  router.post("/skills/:id/approve", (req, res) => {
    const agentId = agentIdFromRequest(req);
    const agentDb = agentDbFromRequest(req, res, agentId, "editor");
    if (!agentDb) return;
    setAiSkillStatus(agentDb, agentId, req.params.id, "active");
    res.json({ skills: listAiSkills(agentDb, false, agentId) });
  });

  // Reject a pending skill → delete the SKILL.md and its state.
  router.delete("/skills/:id", (req, res) => {
    const agentId = agentIdFromRequest(req);
    const agentDb = agentDbFromRequest(req, res, agentId, "editor");
    if (!agentDb) return;
    const ok = deleteSkillFile(agentDb, req.params.id);
    res.json({ ok, skills: listAiSkills(agentDb, false, agentId) });
  });

  router.get("/artifacts", (req, res) => {
    const agentId = agentIdFromRequest(req);
    const agentDb = agentDbFromRequest(req, res, agentId, "viewer");
    if (!agentDb) return;
    const limit = req.query.limit != null ? Number(req.query.limit) : undefined;
    res.json({ artifacts: listArtifacts(agentDb, agentId, limit) });
  });

  router.get("/artifacts/:id", (req, res) => {
    const agentId = agentIdFromRequest(req);
    const agentDb = agentDbFromRequest(req, res, agentId, "viewer");
    if (!agentDb) return;
    const wantContent = req.query.content === "1";
    if (wantContent) {
      try {
        const { artifact, content } = readArtifact(agentDb, agentId, req.params.id);
        res.json({ ...artifact, content });
        return;
      } catch {
        res.status(404).json({ error: "Artifact not found" });
        return;
      }
    }
    const artifact = getArtifact(agentDb, agentId, req.params.id);
    if (!artifact) {
      res.status(404).json({ error: "Artifact not found" });
      return;
    }
    res.json(artifact);
  });

  router.post("/artifacts", (req, res) => {
    const agentId = agentIdFromRequest(req);
    const agentDb = agentDbFromRequest(req, res, agentId, "editor");
    if (!agentDb) return;
    const name = String(req.body?.name ?? "").trim();
    if (!name) {
      res.status(400).json({ error: "name required" });
      return;
    }
    try {
      const artifact = saveArtifact(agentDb, agentId, {
        name,
        content: String(req.body?.content ?? ""),
        kind: req.body?.kind,
        mimeType: req.body?.mimeType,
        description: req.body?.description,
        source: req.body?.source ?? "manual",
      });
      res.status(201).json(artifact);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.delete("/artifacts/:id", (req, res) => {
    const agentId = agentIdFromRequest(req);
    const agentDb = agentDbFromRequest(req, res, agentId, "editor");
    if (!agentDb) return;
    res.json({ ok: deleteArtifact(agentDb, agentId, req.params.id) });
  });

  router.get("/commands", (req, res) => {
    res.json({ commands: AI_CHAT_COMMANDS });
  });

  router.get("/tools", (req, res) => {
    const agentId = String(req.query.agentId ?? "intelligence");
    res.json({ tools: listVisibleTools(tdb(req), agentId) });
  });

  router.get("/agents", (req, res) => {
    res.json({ agents: listAgents(tdb(req)) });
  });

  // An agent is "active" (currently performing work) if any of:
  //  (a) a workflow run for one of its workflows is running/awaiting,
  //  (b) a queued prompt job for one of its workflows is pending/running, or
  //  (c) a card assigned to it sits in the In Progress column (status working).
  router.get("/agents/active", (req, res) => {
    const ids = new Set<string>();
    const collect = (rows: Array<{ agent_id?: string | null }>) => {
      for (const r of rows) {
        if (r.agent_id) ids.add(r.agent_id);
      }
    };
    try {
      collect(
        tdb(req)
          .prepare(
            `SELECT DISTINCT w.agent_id AS agent_id
             FROM ai_workflow_runs r
             JOIN ai_workflows w ON w.id = r.workflow_id
             WHERE r.status IN ('running','awaiting','awaiting_input')`
          )
          .all() as Array<{ agent_id: string | null }>
      );
      collect(
        tdb(req)
          .prepare(
            `SELECT DISTINCT w.agent_id AS agent_id
             FROM ai_prompt_queue q
             JOIN ai_workflows w ON w.id = q.workflow_id
             WHERE q.status IN ('pending','running')`
          )
          .all() as Array<{ agent_id: string | null }>
      );
      collect(
        tdb(req)
          .prepare(
            `SELECT DISTINCT assigned_agent_id AS agent_id
             FROM ai_project_cards
             WHERE assigned_agent_id IS NOT NULL
               AND column_id = 'in_progress'
               AND (status IS NULL OR status NOT IN ('accepted','done'))`
          )
          .all() as Array<{ agent_id: string | null }>
      );
    } catch {
      /* tolerate partial schema */
    }
    res.json({ activeAgentIds: Array.from(ids) });
  });

  router.get("/agents/assignments", (req, res) => {
    res.json({ assignments: listAssignments(tdb(req)) });
  });

  router.get("/platform/actions", (req, res) => {
    const limit = req.query.limit != null ? Number(req.query.limit) : 50;
    res.json({ actions: listPlatformActions(tdb(req), limit) });
  });

  router.put("/agents/assignments", (req, res) => {
    const { scopeType, scopeId, agentId, role } = req.body ?? {};
    if (!isAssignmentScopeType(scopeType)) {
      res.status(400).json({ error: "invalid scopeType" });
      return;
    }
    if (typeof scopeId !== "string" || scopeId.trim().length === 0) {
      res.status(400).json({ error: "scopeId required" });
      return;
    }
    try {
      const assignment = setAssignment(
          tdb(req),
        scopeType,
        scopeId,
        agentId,
        role ?? null
      );
      res.json({ ok: true, assignment });
    } catch (err) {
      if (err instanceof AssignmentError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.get("/agents/resolve", (req, res) => {
    const departmentId = String(req.query.departmentId ?? "").trim();
    if (!departmentId) {
      res.status(400).json({ error: "departmentId required" });
      return;
    }
    const divisionId = req.query.divisionId
      ? String(req.query.divisionId).trim()
      : null;
    const pageId = req.query.pageId ? String(req.query.pageId).trim() : null;
    res.json(resolveAgentForPage(tdb(req), { departmentId, divisionId, pageId }));
  });

  router.get("/agents/:id", (req, res) => {
    const scope = resolveAgentScope(req, req.params.id, "viewer");
    if (!scope) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const agent = getAgent(scope.db, req.params.id);
    if (!agent) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ ...agent, shared: !scope.owned, shareRole: scope.role });
  });

  router.post("/agents", (req, res) => {
    const { name, description, icon, backend, cloneFromId, parentId, systemPrompt, sampling, thinking, toolAllow, autoApprove, modelPath, adapterIds, config } =
      req.body ?? {};
    if (!name?.trim()) {
      res.status(400).json({ error: "name required" });
      return;
    }
    const agent = createAgent(tdb(req), {
      name: String(name).trim(),
      description,
      icon,
      backend,
      cloneFromId,
      parentId: parentId === null || parentId === undefined ? undefined : String(parentId),
      systemPrompt,
      sampling,
      thinking,
      toolAllow,
      autoApprove,
      modelPath,
      adapterIds,
      config,
    });
    res.status(201).json(agent);
  });

  router.post("/agents/:id/clone", (req, res) => {
    const scope = resolveAgentScope(req, req.params.id, "viewer");
    if (!scope) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const src = getAgent(scope.db, req.params.id);
    if (!src) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const name = String(req.body?.name ?? `${src.name} copy`).trim();
    const agent = createAgent(tdb(req), {
      name,
      description: src.description ?? undefined,
      icon: src.icon ?? undefined,
      backend: src.backend,
      systemPrompt: src.systemPrompt,
      sampling: src.sampling,
      thinking: src.thinking,
      toolAllow: src.toolAllow,
      autoApprove: src.autoApprove,
      modelPath: src.modelPath,
      adapterIds: src.adapterIds,
      config: src.config,
    });
    res.status(201).json(agent);
  });

  router.put("/agents/:id", (req, res) => {
    const scope = resolveAgentScope(req, req.params.id, "editor");
    if (!scope) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patchConfig = body.config as Record<string, unknown> | undefined;
    if (
      patchConfig &&
      ("codeAccess" in patchConfig || "codeAutonomy" in patchConfig) &&
      !req.user?.isAdmin
    ) {
      res.status(403).json({ error: "Platform admin required to change coding permissions" });
      return;
    }
    const agent = updateAgent(scope.db, req.params.id, body);
    if (!agent) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(agent);
  });

  router.get("/agents/:id/accounts", (req, res) => {
    const scope = resolveAgentScope(req, req.params.id, "viewer");
    if (!scope) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ accounts: listAgentAccounts(scope.db, req.params.id) });
  });

  router.post("/agents/:id/accounts/apikey", (req, res) => {
    const scope = resolveAgentScope(req, req.params.id, "editor");
    if (!scope) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const provider = String(req.body?.provider ?? "").trim();
    const apiKey = String(req.body?.apiKey ?? "").trim();
    if (!provider || !apiKey) {
      res.status(400).json({ error: "provider and apiKey required" });
      return;
    }
    const account = createAgentApiKeyAccount(scope.db, {
      agentId: req.params.id,
      provider,
      label: typeof req.body?.label === "string" ? req.body.label : undefined,
      apiKey,
    });
    res.status(201).json({ account });
  });

  router.delete("/agents/:id/accounts/:accountId", (req, res) => {
    const scope = resolveAgentScope(req, req.params.id, "editor");
    if (!scope) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const ok = revokeAgentAccount(scope.db, req.params.accountId, req.params.id);
    res.json({ ok });
  });

  router.delete("/agents/:id", (req, res) => {
    const scope = resolveAgentScope(req, req.params.id, "owner");
    if (!scope?.owned) {
      res.status(scope ? 403 : 404).json({
        error: scope ? "Cannot delete a shared agent" : "Not found",
      });
      return;
    }
    const ok = deleteAgent(scope.db, req.params.id);
    res.json({ ok });
  });

  router.get("/agents/:id/reflection", (req, res) => {
    const scope = resolveAgentScope(req, req.params.id, "viewer");
    if (!scope) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ reflection: getReflectionConfig(scope.db, req.params.id) });
  });

  router.patch("/agents/:id/reflection", (req, res) => {
    const scope = resolveAgentScope(req, req.params.id, "editor");
    if (!scope) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const next = patchReflectionConfig(scope.db, req.params.id, req.body ?? {});
    reflection?.reload();
    res.json({ reflection: next });
  });

  router.post("/agents/:id/reflection/run", (req, res) => {
    const scope = resolveAgentScope(req, req.params.id, "editor");
    if (!scope) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!reflection) {
      res.status(503).json({ error: "Reflection service unavailable" });
      return;
    }
    const jobId = reflection.enqueueReflection(req.params.id, "manual", scope.tenantId);
    res.json({ ok: true, jobId });
  });

  router.get("/agents/:id/reflection/proposals", (req, res) => {
    const scope = resolveAgentScope(req, req.params.id, "viewer");
    if (!scope) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const status = String(req.query.status ?? "pending") as
      | "pending"
      | "approved"
      | "rejected"
      | "all";
    res.json({ proposals: listReflectionProposals(scope.db, req.params.id, status) });
  });

  router.post("/reflection/proposals/:id/approve", (req, res) => {
    const ok = approveReflectionProposal(tdb(req), req.params.id);
    if (!ok) {
      res.status(404).json({ error: "Proposal not found or not pending" });
      return;
    }
    res.json({ ok: true });
  });

  router.post("/reflection/proposals/:id/reject", (req, res) => {
    const ok = rejectReflectionProposal(tdb(req), req.params.id);
    if (!ok) {
      res.status(404).json({ error: "Proposal not found or not pending" });
      return;
    }
    res.json({ ok: true });
  });

  router.post("/memory/distill", (req, res) => {
    if (!memoryMaintenance) {
      res.status(503).json({ error: "Memory maintenance not available" });
      return;
    }
    const chatId = String(req.body?.chatId ?? "");
    const agentId = String(req.body?.agentId ?? "intelligence");
    if (!chatId) {
      res.status(400).json({ error: "chatId required" });
      return;
    }
    const jobId = memoryMaintenance.enqueueDistill({
      chatId,
      agentId,
      tenantId: req.tenantId,
      force: Boolean(req.body?.force),
    });
    res.json({ ok: true, jobId });
  });

  router.post("/memory/wiki-synthesize", (req, res) => {
    if (!memoryMaintenance) {
      res.status(503).json({ error: "Memory maintenance not available" });
      return;
    }
    const jobId = memoryMaintenance.enqueueWikiSynthesize(
      req.tenantId ?? "",
      String(req.body?.agentId ?? "intelligence")
    );
    res.json({ ok: true, jobId });
  });

  router.get("/secrets", (req, res) => {
    // Cursor subscription key is managed by the Cursor card — hide from generic list.
    const secrets = listSecrets(tdb(req)).filter(
      (s) =>
        s.id !== "cursor-api-key" &&
        s.name !== "cursor_api_key" &&
        s.name !== "CURSOR_API_KEY"
    );
    res.json({ secrets });
  });

  router.post("/secrets", (req, res) => {
    const { name, value } = req.body ?? {};
    if (!name?.trim() || !value?.trim()) {
      res.status(400).json({ error: "name and value required" });
      return;
    }
    const trimmedName = String(name).trim();
    if (
      trimmedName === "cursor_api_key" ||
      trimmedName === "CURSOR_API_KEY" ||
      trimmedName.toLowerCase() === "cursor-api-key"
    ) {
      res.status(400).json({
        error:
          "Use Vault → Cursor subscription → Connect for Cursor API keys (not this list).",
      });
      return;
    }
    res.status(201).json(createSecret(tdb(req), trimmedName, String(value)));
  });

  router.delete("/secrets/:id", (req, res) => {
    res.json({ ok: deleteSecret(tdb(req), req.params.id) });
  });

  router.get("/cursor/status", async (req, res) => {
    const db = tdb(req);
    normalizeCursorVaultSecret(db);
    const status = getCursorAuthStatus(db);
    const cli = await probeCursorCliAuth().catch(() => ({
      ok: false,
      detail: "cursor-agent unavailable",
    }));
    res.json({
      ...status,
      cliAuthenticated: cli.ok,
      cliDetail: cli.detail,
    });
  });

  router.post("/cursor/api-key", (req, res) => {
    const apiKey = String(req.body?.apiKey ?? "").trim();
    if (!apiKey) {
      res.status(400).json({ error: "apiKey required" });
      return;
    }
    const db = tdb(req);
    upsertCursorApiKey(db, apiKey);
    markLlmReady(db);
    res.json({ ok: true, status: getCursorAuthStatus(db) });
  });

  router.delete("/cursor/api-key", (req, res) => {
    const db = tdb(req);
    res.json({ ok: removeCursorApiKey(db), status: getCursorAuthStatus(db) });
  });

  router.get("/cursor/models", async (req, res) => {
    try {
      const models = await listCursorSubscriptionModels(tdb(req));
      res.json({ models });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/cursor/cli-login-url", async (_req, res) => {
    try {
      const result = await startCursorCliLoginUrl();
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/cursor/use-for-intelligence", async (req, res) => {
    try {
      const db = tdb(req);
      if (!getCursorAuthStatus(db).connected) {
        res.status(400).json({ error: "Connect Cursor with an API key first" });
        return;
      }
      const model = req.body?.model ? String(req.body.model) : "auto";
      const result = await selectIntelligenceModel(db, llm, {
        source: "cursor",
        model,
      });
      res.json({ ok: true, agent: getAgent(db, "intelligence"), active: result.active });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  router.get("/model-catalog", async (req, res) => {
    try {
      const catalog = await listModelCatalog(
        tdb(req),
        llm,
        getCoreDb(),
        req.user?.id
      );
      res.json(catalog);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  router.post("/select-model", async (req, res) => {
    try {
      const source = String(req.body?.source ?? "");
      if (
        source !== "local" &&
        source !== "cursor" &&
        source !== "provider" &&
        source !== "remote"
      ) {
        res.status(400).json({ error: "source must be local, cursor, provider, or remote" });
        return;
      }
      const result = await selectIntelligenceModel(tdb(req), llm, {
        source,
        path: req.body?.path ? String(req.body.path) : undefined,
        model: req.body?.model ? String(req.body.model) : undefined,
        provider: req.body?.provider,
        endpointId: req.body?.endpointId ? String(req.body.endpointId) : undefined,
        apiKeyRef: req.body?.apiKeyRef ? String(req.body.apiKeyRef) : undefined,
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  router.post("/start", async (req, res) => {
    try {
      const status = await llm.start(req.body?.modelPath);
      res.json(status);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  router.post("/stop", async (req, res) => {
    try {
      res.json(await llm.stop());
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  router.post("/restart", async (req, res) => {
    try {
      res.json(await llm.restart(req.body?.modelPath));
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  router.get("/chats", (req, res) => {
    const userId = req.user!.id;
    const ownDb = tdb(req);
    const ownRows = ownDb
      .prepare(
        `SELECT id, title, created_at, updated_at, user_id
         FROM ai_chats
         WHERE user_id IS NULL OR user_id = ?
         ORDER BY updated_at DESC LIMIT 50`
      )
      .all(userId) as Array<{
      id: string;
      title: string;
      created_at: string;
      updated_at: string;
      user_id: string | null;
    }>;

    const merged = new Map<
      string,
      Record<string, unknown> & { shared?: boolean; homeTenantId?: string }
    >();
    for (const row of ownRows) {
      merged.set(row.id, { ...row, shared: false });
    }

    const core = getCoreDb();
    for (const session of listSharedChatSessionsForUser(core, userId)) {
      if (!canAccessSharedSession(req, session)) continue;
      if (merged.has(session.chat_id)) {
        merged.get(session.chat_id)!.shared = true;
        merged.get(session.chat_id)!.homeTenantId = session.home_tenant_id;
        continue;
      }
      try {
        const homeDb = getTenantDb(session.home_tenant_id);
        const row = homeDb
          .prepare(
            `SELECT id, title, created_at, updated_at, user_id
             FROM ai_chats WHERE id = ?`
          )
          .get(session.chat_id) as
          | {
              id: string;
              title: string;
              created_at: string;
              updated_at: string;
              user_id: string | null;
            }
          | undefined;
        if (row) {
          merged.set(row.id, {
            ...row,
            shared: true,
            homeTenantId: session.home_tenant_id,
          });
        }
      } catch {
        /* skip unreachable home tenant */
      }
    }

    const chats = [...merged.values()].sort(
      (a, b) =>
        String(b.updated_at).localeCompare(String(a.updated_at))
    );
    res.json(chats);
  });

  router.post("/chats", (req, res) => {
    const id = uuidv4();
    const title = String(req.body?.title ?? "New chat").slice(0, 120);
    tdb(req)
      .prepare(`INSERT INTO ai_chats (id, title, user_id) VALUES (?, ?, ?)`)
      .run(id, title, req.user!.id);
    const row = tdb(req)
      .prepare(`SELECT id, title, created_at, updated_at FROM ai_chats WHERE id = ?`)
      .get(id);
    res.status(201).json(row);
  });

  router.get("/chats/:id", (req, res) => {
    // Chats are the actor's work: read from the actor's own DB, or the shared
    // session's home DB when this chat was promoted to a collaborative session.
    const { db: chatDb } = resolveChatWorkScope(req, req.params.id);
    const row = chatDb
      .prepare(`SELECT id, title, created_at, updated_at FROM ai_chats WHERE id = ?`)
      .get(req.params.id);
    if (!row) {
      res.status(404).json({ error: "Chat not found" });
      return;
    }
    res.json(row);
  });

  router.delete("/chats/:id", (req, res) => {
    const { db: chatDb } = resolveChatWorkScope(req, req.params.id);
    chatDb.prepare(`DELETE FROM ai_messages WHERE chat_id = ?`).run(req.params.id);
    const result = chatDb
      .prepare(`DELETE FROM ai_chats WHERE id = ?`)
      .run(req.params.id);
    res.json({ ok: result.changes > 0 });
  });

  router.get("/chats/:id/messages", (req, res) => {
    const { db: chatDb } = resolveChatWorkScope(req, req.params.id);
    const rows = chatDb
      .prepare(
        `SELECT id, chat_id, role, content_json, created_at FROM ai_messages
         WHERE chat_id = ? ORDER BY created_at ASC`
      )
      .all(req.params.id) as Array<{
      id: string;
      chat_id: string;
      role: string;
      content_json: string;
      created_at: string;
    }>;
    res.json(
      rows.map((r) => ({
        ...r,
        content: JSON.parse(r.content_json),
      }))
    );
  });

  // Resolve a chat's shared-session status (its cross-tenant home), if any.
  router.get("/chats/:id/session", (req, res) => {
    const session = getSharedChatSession(getCoreDb(), req.params.id);
    if (!session || !canAccessSharedSession(req, session)) {
      res.json({ shared: false, session: null });
      return;
    }
    res.json({
      shared: true,
      session: {
        id: session.id,
        chatId: session.chat_id,
        agentId: session.agent_id,
        homeTenantId: session.home_tenant_id,
        createdByUserId: session.created_by_user_id,
        createdAt: session.created_at,
        isHome: req.tenantId === session.home_tenant_id,
      },
    });
  });

  // Promote a chat to a collaborative shared session. The initiator's tenant
  // becomes the session's home (the chat already lives there). Participants
  // (agent owner / grantees) then route reads+writes to the home DB and both
  // sides receive live updates via the agent room.
  router.post("/chats/:id/share", (req, res) => {
    const chatId = req.params.id;
    const agentId = String(req.body?.agentId ?? agentIdFromRequest(req));
    // You can only start a shared session for a chat that lives in YOUR own
    // workspace (your work DB) — i.e. a chat you initiated.
    const ownDb = tdb(req);
    const chat = ownDb
      .prepare(`SELECT id FROM ai_chats WHERE id = ?`)
      .get(chatId);
    if (!chat) {
      res.status(404).json({ error: "Chat not found in your workspace" });
      return;
    }
    // Confirm the caller can use this agent (owned or shared to them).
    if (!resolveAgentScope(req, agentId, "viewer")) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    const session = createSharedChatSession(getCoreDb(), {
      id: uuidv4(),
      chatId,
      homeTenantId: req.tenantId!,
      agentId,
      createdByUserId: req.user!.id,
    });
    // Notify the agent room so participants can refresh into the shared session.
    broadcastAgentEvent(
      agentId,
      "chat_session_shared",
      { chatId, agentId, homeTenantId: session.home_tenant_id },
      req.tenantId
    );
    res.status(201).json({
      ok: true,
      session: {
        id: session.id,
        chatId: session.chat_id,
        agentId: session.agent_id,
        homeTenantId: session.home_tenant_id,
        createdByUserId: session.created_by_user_id,
        createdAt: session.created_at,
        isHome: true,
      },
    });
  });

  router.post("/chat", async (req, res) => {
    const {
      chatId,
      message,
      history = [],
      platformContext,
      images = [],
      agentId,
      contributeMemory = false,
      autoAcceptTools = false,
      chatMode: rawChatMode,
      toolAutonomy: rawToolAutonomy,
    } = req.body as {
      chatId?: string;
      message: string;
      history?: HistoryTurn[];
      platformContext?: PlatformContext;
      images?: string[];
      agentId?: string;
      contributeMemory?: boolean;
      autoAcceptTools?: boolean;
      chatMode?: IntelligenceChatMode;
      toolAutonomy?: CodeAutonomyLevel;
    };

    const chatMode: IntelligenceChatMode =
      rawChatMode === "plan" || rawChatMode === "ask" ? rawChatMode : "agent";
    const sessionAutonomy: CodeAutonomyLevel =
      rawToolAutonomy === "writes" || rawToolAutonomy === "full"
        ? rawToolAutonomy
        : autoAcceptTools
          ? "full"
          : "off";

    const resolvedAgentId = agentId ?? "intelligence";
    const scope = resolveAgentScope(req, resolvedAgentId, "viewer");
    if (!scope) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    let agent;
    try {
      agent = resolveAgent(scope.db, resolvedAgentId);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : "Agent not found" });
      return;
    }

    if (!llm.isReady() && !agentCanRunWithoutLocalLlm(agent.backend, scope.db)) {
      res.status(503).json({
        error:
          "LLM server not running. Start a local model, or connect Cursor subscription in Vault.",
      });
      return;
    }

    if (!message?.trim() && images.length === 0) {
      res.status(400).json({ error: "Message or image required" });
      return;
    }

    // ENGINE vs WORK split. The engine DB (agent owner's, or own when owned)
    // provides agent config, system prompt, tool definitions, and memory READS.
    // The work DB (always the actor's own tenant, or a shared session's home)
    // owns produced work: chats, messages, artifacts, and memory WRITES. For an
    // owned agent engineDb === workDb so behavior is byte-for-byte unchanged.
    const engineDb = scope.db;
    const work = resolveChatWorkScope(req, chatId);
    const workDb = work.db;
    // Contribute-back: mirror new memories into the owner's engine DB only when
    // the caller opts in AND the agent is shared (no-op for owned agents).
    const contributeDb =
      contributeMemory && !scope.owned ? engineDb : undefined;

    let activeChatId = chatId;
    if (!activeChatId) {
      activeChatId = uuidv4();
      const title = message.trim().slice(0, 80) || "New chat";
      workDb.prepare(`INSERT INTO ai_chats (id, title) VALUES (?, ?)`).run(
        activeChatId,
        title
      );
    } else {
      workDb.prepare(`UPDATE ai_chats SET updated_at = datetime('now') WHERE id = ?`).run(
        activeChatId
      );
    }

    const userParts: ChatMessagePart[] = [];
    if (message?.trim()) userParts.push({ type: "text", text: message.trim() });
    for (const img of images) {
      const url = img.startsWith("data:") ? img : `data:image/png;base64,${img}`;
      userParts.push({ type: "image_url", image_url: { url } });
    }

    const userContent =
      userParts.length === 1 && userParts[0].type === "text"
        ? userParts[0].text!
        : userParts;

    const userMsgId = uuidv4();
    workDb.prepare(
      `INSERT INTO ai_messages (id, chat_id, role, content_json, user_id) VALUES (?, ?, 'user', ?, ?)`
    ).run(userMsgId, activeChatId, JSON.stringify({ text: message, images }), req.user!.id);

    broadcastAgentEvent(
      resolvedAgentId,
      "chat_message",
      {
        chatId: activeChatId,
        messageId: userMsgId,
        role: "user",
        agentId: resolvedAgentId,
        shared: !scope.owned,
        sharedSession: Boolean(work.session),
      },
      work.tenantId
    );

    const flowConfig = loadPromptFlowConfig(engineDb);
    const harnessProfile = resolveProfileForAgent(
      agent,
      llm.getStatus().modelPath
    );
    // Semantic (RAG) memory READS come from the engine DB (the agent owner's
    // accumulated knowledge powers the engine). Falls back to recency inside the
    // helper when the embedder is down, so chat never blocks on embeddings.
    if (embeddings) {
      void embeddings.ensureTenantBackfill(scope.tenantId);
    }
    const memoryOverride = embeddings
      ? await getSemanticMemoriesText(
          engineDb,
          embeddings.getEmbeddingClient(),
          message?.trim() ?? "",
          { chatId: activeChatId, agentId: agent.id, topK: config.embeddings.ragTopK }
        )
      : undefined;
    const capabilitiesOverride = embeddings
      ? await getCapabilitiesText(
          engineDb,
          embeddings.getEmbeddingClient(),
          message?.trim() ?? "",
          { agentId: agent.id, topK: config.embeddings.ragTopK }
        )
      : undefined;
    const wikiTenantIds = [
      ...new Set(
        [req.tenantId, scope.tenantId, work.tenantId].filter(
          (id): id is string => Boolean(id)
        )
      ),
    ];
    const wikiOverride = await getHybridWikiText(
      getCoreDb(),
      embeddings?.isEmbedderReady() ? embeddings.getEmbeddingClient() : undefined,
      message?.trim() ?? "",
      {
        tenantIds: wikiTenantIds.length ? wikiTenantIds : [scope.tenantId].filter(Boolean),
        topK: config.embeddings.wikiRagTopK,
      }
    );
    const assembled = assemblePrompt(engineDb, {
      basePrompt: agent.systemPrompt,
      platformContext,
      chatId: activeChatId,
      historyCount: history.length,
      userPreview: message?.trim(),
      flowConfig,
      enableThinking: agent.thinking.enableThinking,
      thinkingEfficiency: agent.thinking.thinkingEfficiency,
      nativeTools: agent.thinking.nativeTools,
      agentId: agent.id,
      tenantId: req.tenantId,
      agent,
      memoryOverride,
      wikiOverride: wikiOverride || undefined,
      capabilitiesOverride,
      chatMode,
      harnessDelta: harnessProfile.harnessDelta,
    });
    const systemPrompt = assembled.systemPrompt;

    const historyAgentMessages = historyToAgentMessages(history, {
      stripThinking: harnessProfile.stripThinkingFromHistory,
    });
    const ctxBudget = Math.floor(llm.getStatus().ctxSize * 4 * HISTORY_CHAR_BUDGET_RATIO);
    const { messages: compactedHistory, droppedTurns } = compactAgentMessages(
      historyAgentMessages,
      ctxBudget
    );
    if (droppedTurns > 0 && activeChatId && memoryMaintenance) {
      // Compaction erased turns — enqueue distill so episodic knowledge survives.
      memoryMaintenance.enqueueDistill({
        chatId: activeChatId,
        agentId: agent.id,
        tenantId: work.tenantId,
      });
    }

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...compactedHistory.map((h) => ({
        role: h.role as "user" | "assistant",
        content: h.content,
        ...(h.tool_calls ? { tool_calls: h.tool_calls } : {}),
        ...(h.tool_call_id ? { tool_call_id: h.tool_call_id, name: h.name } : {}),
      })),
      { role: "user", content: userContent },
    ];

    const sampling = applyProfileSampling(
      {
        temperature: agent.sampling.temperature,
        topP: agent.sampling.topP,
        topK: agent.sampling.topK,
        minP: agent.sampling.minP,
        repeatPenalty: agent.sampling.repeatPenalty,
        presencePenalty: agent.sampling.presencePenalty,
        frequencyPenalty: agent.sampling.frequencyPenalty,
        maxTokens: agent.sampling.maxTokens,
        seed: agent.sampling.seed,
      },
      harnessProfile
    );

    // Snapshot what we send so the AI Settings inspector can show it. Image
    // payloads are huge base64 blobs, so we only record their count.
    llm.recordLastRequest({
      at: new Date().toISOString(),
      systemPrompt,
      sampling,
      endpoint: `${llm.getServerBaseUrl()}/v1/chat/completions`,
      sections: assembled.sections,
      omitted: assembled.omitted,
      messages: messages.map((m) => {
        const parts = Array.isArray(m.content) ? m.content : [m.content];
        const text = parts
          .map((p) => (typeof p === "string" ? p : p.text ?? ""))
          .join(" ");
        const images = Array.isArray(m.content)
          ? m.content.filter((p) => typeof p !== "string" && p.type === "image_url").length
          : 0;
        return {
          role: m.role,
          preview: text.length > 500 ? `${text.slice(0, 500)}…` : text,
          images,
        };
      }),
    });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    send("chat_id", { chatId: activeChatId });

    const abortController = new AbortController();
    const onClientClose = () => abortController.abort();
    req.on("close", onClientClose);
    res.on("close", onClientClose);

    let fullContent = "";
    let reasoningRaw = "";
    let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    // Server-side accumulation of Cursor-style parts (thinking / tool / todos /
    // text) so a reloaded chat replays tool cards and reasoning faithfully.
    type ServerPart = Record<string, unknown> & { kind: string };
    const parts: ServerPart[] = [];
    let segRaw = "";
    const isTodoTool = (n: string) =>
      n === "todo_write" || n === "update_todos" || n === "write_todos";
    const commitSeg = () => {
      if (!segRaw.trim()) {
        segRaw = "";
        return;
      }
      const { thinking: th, answer: ans } = parseThinking(segRaw);
      if (th) parts.push({ kind: "thinking", text: th, startedAt: 0, endedAt: 0 });
      if (ans) parts.push({ kind: "text", text: ans });
      segRaw = "";
    };
    const partReasoning = (chunk: string) => {
      reasoningRaw += chunk;
      const last = parts[parts.length - 1];
      if (last?.kind === "thinking") {
        last.text = (last.text as string) + chunk;
      } else {
        parts.push({ kind: "thinking", text: chunk, startedAt: 0, endedAt: 0 });
      }
    };
    const partToolCall = (
      name: string,
      args: Record<string, unknown>,
      id?: string
    ) => {
      commitSeg();
      if (isTodoTool(name)) {
        // Normalize the same way the executor does so the in-chat checklist
        // mirrors the persisted Kanban cards even when the model emits the list
        // under aliases (tasks/items) or items with text/columnId fields.
        const items = normalizeTodoItems(args);
        const existing = parts.find((p) => p.kind === "todos");
        if (existing) existing.items = items;
        else parts.push({ kind: "todos", items });
        return;
      }
      parts.push({
        kind: "tool",
        id: id ?? `t-${parts.length}`,
        name,
        args,
        status: "running",
        startedAt: 0,
      });
    };
    const partToolResult = (result: unknown, id?: string, isError?: boolean) => {
      for (let i = parts.length - 1; i >= 0; i--) {
        if (parts[i].kind === "tool" && parts[i].id === id) {
          parts[i].result = result;
          parts[i].status = isError ? "error" : "done";
          parts[i].endedAt = 0;
          break;
        }
      }
    };

    try {
      const baseUrl = llm.getServerBaseUrl();
      const agentMessages: AgentMessage[] = messages.map((m) => ({
        role: m.role as AgentMessage["role"],
        content:
          typeof m.content === "string"
            ? m.content
            : m.content
                .map((p) => (typeof p === "string" ? p : p.text ?? ""))
                .join("\n"),
        ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id, name: m.name } : {}),
      }));

      if (agent.thinking.nativeTools || agent.backend !== "local") {
        let streamed = "";
        // Backend (LoRA/config) and advertised tool definitions come from the
        // engine DB; tool execution writes (artifacts, memory) land in the work
        // DB. Memory contribute-back (if enabled) mirrors into the engine DB.
        const backend = getBackend(agent, engineDb, llm);
        const rawSchemas = getToolSchemasForLlm(engineDb, agent.id, chatMode);
        const toolSchemas = filterSchemasForProfile(rawSchemas, harnessProfile, {
          userMessage: message?.trim(),
          pathname: platformContext?.pathname,
          mentionIds: platformContext?.mentionedSources?.map((s) => s.id) ?? [],
        });
        const answer = await backend.run({
          agent,
          messages: agentMessages,
          chatMode,
          toolSchemas,
          toolMode:
            harnessProfile.toolMode === "grammar" ? "grammar" : "native",
          samplingOverlay: {
            temperature: harnessProfile.sampling.temperature,
            topP: harnessProfile.sampling.topP,
            topK: harnessProfile.sampling.topK,
          },
          toolCtx: {
            db: workDb,
            contributeDb,
            chatId: activeChatId,
            bridgePort,
            llm,
            queue,
            embedder: embeddings?.isEmbedderReady()
              ? embeddings.getEmbeddingClient()
              : undefined,
            activeAgentId: agent.id,
            userId: req.user?.id,
            tenantId: work.tenantId,
            sessionAutonomy,
            onTerminalOutput: (chunk) => {
              send("terminal_output", {
                toolCallId: chunk.toolCallId,
                stream: chunk.stream,
                text: chunk.text,
              });
            },
          },
          abortSignal: abortController.signal,
          maxIterations: harnessProfile.maxChatIterations,
          onToken: (chunk) => {
            streamed += chunk;
            segRaw += chunk;
            send("token", { content: chunk });
          },
          onReasoning: (chunk) => {
            partReasoning(chunk);
            send("reasoning", { content: chunk });
          },
          onToolCall: (name, args, toolCallId) => {
            partToolCall(name, args, toolCallId);
            send("tool_call", { toolCallId, name, args });
          },
          onToolCallDelta: (toolCallId, name, args) => {
            let found = false;
            for (let i = parts.length - 1; i >= 0; i--) {
              if (parts[i].kind === "tool" && parts[i].id === toolCallId) {
                parts[i].args = args;
                parts[i].name = name;
                found = true;
                break;
              }
            }
            if (!found) {
              partToolCall(name, args, toolCallId);
            }
            send("tool_call_delta", { toolCallId, name, args });
          },
          onToolResult: (name, result, toolCallId, isError) => {
            partToolResult(result, toolCallId, isError);
            send("tool_result", { toolCallId, name, result, isError });
          },
          onTerminalOutput: (toolCallId, chunk) => {
            send("terminal_output", { toolCallId, ...chunk });
          },
          onUsage: (u) => {
            usage = u;
          },
          onConfirmRequired: async ({ toolCallId, name, args }) => {
            const auto = await import("../services/confirm-policy.js").then((m) =>
              m.shouldAutoApproveTool(
                agent,
                name,
                undefined,
                { toolCallId, name, args },
                sessionAutonomy
              )
            );
            if (auto) return true;
            send("tool_confirm_required", { toolCallId, name, args });
            return waitForToolConfirmation(toolCallId);
          },
        });
        fullContent = answer || streamed;
        // Estimate token usage for backends that don't report it, so the
        // context meter works for native-tools / provider / cursor agents.
        if (!usage.total_tokens) {
          const promptChars = agentMessages.reduce(
            (a, m) => a + (m.content?.length ?? 0),
            0
          );
          const pt = Math.ceil(promptChars / 4);
          const ct = Math.ceil(fullContent.length / 4);
          usage = {
            prompt_tokens: pt,
            completion_tokens: ct,
            total_tokens: pt + ct,
          };
        }
      } else {
        const upstream = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "default",
            messages,
            stream: true,
            stream_options: { include_usage: true },
            temperature: sampling.temperature,
            top_p: sampling.topP,
            top_k: sampling.topK,
            min_p: sampling.minP,
            repeat_penalty: sampling.repeatPenalty,
            presence_penalty: sampling.presencePenalty,
            frequency_penalty: sampling.frequencyPenalty,
            max_tokens: sampling.maxTokens > 0 ? sampling.maxTokens : undefined,
            seed: sampling.seed >= 0 ? sampling.seed : undefined,
          }),
        });

        if (!upstream.ok) {
          const errText = await upstream.text();
          send("error", { error: errText });
          res.end();
          return;
        }

        const reader = upstream.body?.getReader();
        if (!reader) {
          send("error", { error: "No response body" });
          res.end();
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            if (payload === "[DONE]") continue;

            try {
              const parsed = JSON.parse(payload) as {
                choices?: Array<{ delta?: { content?: string } }>;
                usage?: typeof usage;
              };
              const delta = parsed.choices?.[0]?.delta?.content ?? "";
              if (delta) {
                fullContent += delta;
                segRaw += delta;
                send("token", { content: delta });
              }
              if (parsed.usage) usage = parsed.usage;
            } catch {
              /* skip malformed chunks */
            }
          }
        }
      }

      const { thinking, answer } = parseThinking(fullContent);
      // Finalize the parts stream: flush trailing text and close running tools.
      commitSeg();
      for (const p of parts) {
        if (p.kind === "tool" && p.status === "running") {
          p.status = "done";
          p.endedAt = 0;
        }
      }
      const assistantMsgId = uuidv4();
      workDb.prepare(
        `INSERT INTO ai_messages (id, chat_id, role, content_json) VALUES (?, ?, 'assistant', ?)`
      ).run(
        assistantMsgId,
        activeChatId,
        JSON.stringify({ content: fullContent, thinking, answer, parts })
      );

      broadcastAgentEvent(
        resolvedAgentId,
        "chat_message",
        {
          chatId: activeChatId,
          messageId: assistantMsgId,
          role: "assistant",
          agentId: resolvedAgentId,
          shared: !scope.owned,
          sharedSession: Boolean(work.session),
        },
        work.tenantId
      );

      send("done", {
        content: fullContent,
        thinking,
        answer,
        usage,
        contextWindow: llm.getStatus().ctxSize,
        messageId: assistantMsgId,
      });
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        send("error", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      req.off("close", onClientClose);
      res.off("close", onClientClose);
    }

    res.end();

    // Signal listeners (e.g. the Reflection engine) that a chat turn finished,
    // so they can schedule best-effort post-chat knowledge maintenance. The work
    // tenant + contribute-back intent are carried so a tenant-aware memory
    // engine can route writes to the actor's work DB (and optionally mirror to
    // the owner's engine DB).
    bus?.emit("chat_completed", {
      chatId: activeChatId,
      agentId: agent.id,
      workTenantId: work.tenantId,
      engineTenantId: scope.tenantId,
      contributeMemory: Boolean(contributeDb),
      owned: scope.owned,
    });
  });

  router.post("/chat/confirm-tool", (req, res) => {
    const { toolCallId, approved } = req.body as { toolCallId?: string; approved?: boolean };
    if (!toolCallId) {
      res.status(400).json({ error: "toolCallId required" });
      return;
    }
    const ok = resolveToolConfirmation(toolCallId, Boolean(approved));
    res.json({ ok });
  });

  /** Delete a single message from a chat thread. */
  router.delete("/chats/:chatId/messages/:messageId", (req, res) => {
    const work = resolveChatWorkScope(req, req.params.chatId);
    const r = work.db
      .prepare(`DELETE FROM ai_messages WHERE id = ? AND chat_id = ?`)
      .run(req.params.messageId, req.params.chatId);
    res.json({ ok: r.changes > 0 });
  });

  /** Truncate chat history after a message (for edit/regenerate). */
  router.post("/chats/:chatId/truncate", (req, res) => {
    const { afterMessageId } = req.body as { afterMessageId?: string };
    if (!afterMessageId) {
      res.status(400).json({ error: "afterMessageId required" });
      return;
    }
    const work = resolveChatWorkScope(req, req.params.chatId);
    const anchor = work.db
      .prepare(`SELECT created_at FROM ai_messages WHERE id = ? AND chat_id = ?`)
      .get(afterMessageId, req.params.chatId) as { created_at: string } | undefined;
    if (!anchor) {
      res.status(404).json({ error: "Message not found" });
      return;
    }
    const r = work.db
      .prepare(
        `DELETE FROM ai_messages WHERE chat_id = ? AND created_at > ?`
      )
      .run(req.params.chatId, anchor.created_at);
    res.json({ deleted: r.changes });
  });

  router.get("/lora-adapters", async (req, res) => {
    try {
      if (!llm.isReady()) {
        res.json([]);
        return;
      }
      res.json(await llm.proxyLoraAdapters("GET"));
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post("/lora-adapters", async (req, res) => {
    try {
      res.json(await llm.proxyLoraAdapters("POST", req.body));
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.get("/adapters", (req, res) => {
    const rows = tdb(req).prepare(`SELECT * FROM ai_adapters ORDER BY name ASC`).all();
    res.json({ adapters: rows });
  });

  router.post("/adapters", (req, res) => {
    const id = uuidv4();
    const { name, path, description, domain, defaultScale } = req.body ?? {};
    if (!name || !path) {
      res.status(400).json({ error: "name and path required" });
      return;
    }
    tdb(req).prepare(
      `INSERT INTO ai_adapters (id, name, path, description, domain, default_scale)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, String(name), String(path), description ?? null, domain ?? null, defaultScale ?? 1);
    res.status(201).json(tdb(req).prepare(`SELECT * FROM ai_adapters WHERE id = ?`).get(id));
  });

  router.put("/adapters/:id", (req, res) => {
    const { enabled, defaultScale, description } = req.body ?? {};
    if (enabled != null) {
      tdb(req).prepare(`UPDATE ai_adapters SET enabled = ?, updated_at = datetime('now') WHERE id = ?`).run(
        enabled ? 1 : 0,
        req.params.id
      );
    }
    if (defaultScale != null) {
      tdb(req).prepare(
        `UPDATE ai_adapters SET default_scale = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(Number(defaultScale), req.params.id);
    }
    if (description != null) {
      tdb(req).prepare(
        `UPDATE ai_adapters SET description = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(String(description), req.params.id);
    }
    res.json(tdb(req).prepare(`SELECT * FROM ai_adapters WHERE id = ?`).get(req.params.id));
  });

  router.delete("/adapters/:id", (req, res) => {
    const r = tdb(req).prepare(`DELETE FROM ai_adapters WHERE id = ?`).run(req.params.id);
    res.json({ ok: r.changes > 0 });
  });

  router.get("/queue", (req, res) => {
    const rows = tdb(req)
      .prepare(
        `SELECT * FROM ai_prompt_queue ORDER BY
         CASE status WHEN 'running' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
         priority DESC, created_at ASC LIMIT 100`
      )
      .all();
    res.json({ jobs: rows });
  });

  router.post("/queue", (req, res) => {
    const id = uuidv4();
    const { prompt, workflowId, priority, context, adapterIds } = req.body ?? {};
    tdb(req).prepare(
      `INSERT INTO ai_prompt_queue (id, prompt, workflow_id, priority, context_json, adapter_ids_json)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      prompt ? String(prompt) : null,
      workflowId ?? null,
      Number(priority ?? 0),
      context ? JSON.stringify(context) : null,
      adapterIds ? JSON.stringify(adapterIds) : null
    );
    res.status(201).json(tdb(req).prepare(`SELECT * FROM ai_prompt_queue WHERE id = ?`).get(id));
  });

  router.post("/queue/:id/cancel", (req, res) => {
    tdb(req).prepare(
      `UPDATE ai_prompt_queue SET status = 'cancelled', finished_at = datetime('now') WHERE id = ? AND status IN ('pending','running')`
    ).run(req.params.id);
    res.json({ ok: true });
  });

  const workflowApiRow = (workflow: AiWorkflow) => ({
    id: workflow.id,
    agent_id: workflow.agent_id,
    name: workflow.name,
    config_json: JSON.stringify(workflow.config),
    enabled: workflow.enabled,
    created_at: workflow.created_at,
    updated_at: workflow.updated_at,
  });

  router.get("/workflows", (req, res) => {
    const agentId = String(req.query.agentId ?? "intelligence");
    res.json({
      workflows: listWorkflows(tdb(req))
        .filter((workflow) => workflow.agent_id === agentId)
        .map(workflowApiRow),
    });
  });

  router.post("/workflows", (req, res) => {
    const name = String(req.body?.name ?? "Workflow");
    const agentId = String(req.body?.agentId ?? req.query.agentId ?? "intelligence");
    const config = req.body?.config ?? { nodes: [], edges: [] };
    const workflow = createWorkflow(tdb(req), {
      name,
      agentId,
      config,
    });
    res.status(201).json(workflowApiRow(workflow));
  });

  router.put("/workflows/:id", (req, res) => {
    const { name, config, enabled } = req.body ?? {};
    const workflow = updateWorkflow(tdb(req), req.params.id, {
      name: name == null ? undefined : String(name),
      config: config ?? undefined,
      enabled: enabled == null ? undefined : Boolean(enabled),
    });
    if (!workflow) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }
    res.json(workflowApiRow(workflow));
  });

  // Delete a workflow and detach anything that references it so no dangling
  // schedules/hooks/runs are left pointing at a missing workflow.
  router.delete("/workflows/:id", (req, res) => {
    const id = req.params.id;
    const wf = tdb(req)
      .prepare(`SELECT id FROM ai_workflows WHERE id = ?`)
      .get(id) as { id: string } | undefined;
    if (!wf) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }
    // Tenant-scoped dependents: cron schedules + finished run history.
    const schedules = tdb(req)
      .prepare(`DELETE FROM ai_schedules WHERE workflow_id = ?`)
      .run(id).changes;
    tdb(req).prepare(`DELETE FROM ai_workflow_runs WHERE workflow_id = ?`).run(id);
    tdb(req).prepare(`DELETE FROM ai_workflow_comments WHERE workflow_id = ?`).run(id);
    tdb(req).prepare(`DELETE FROM ai_workflows WHERE id = ?`).run(id);
    // Core-db event/schedule hooks that run THIS workflow (action_config_json
    // carries {"workflowId": id}). Remove them so they don't fire a ghost run.
    let hooks = 0;
    try {
      hooks = getCoreDb()
        .prepare(
          `DELETE FROM hooks
           WHERE action_kind = 'run_workflow' AND action_config_json LIKE ?`
        )
        .run(`%"workflowId":"${id}"%`).changes;
    } catch {
      /* core hooks optional */
    }
    scheduler.reload();
    refreshScheduler();
    res.json({ ok: true, deleted: { workflow: id, schedules, hooks } });
  });

  router.get("/workflows/:id/comments", (req, res) => {
    const rows = tdb(req)
      .prepare(
        `SELECT id, workflow_id, author, body, created_at FROM ai_workflow_comments
         WHERE workflow_id = ? ORDER BY created_at ASC`
      )
      .all(req.params.id);
    res.json({ comments: rows });
  });

  router.post("/workflows/:id/comments", (req, res) => {
    const body = String(req.body?.body ?? "").trim();
    if (!body) {
      res.status(400).json({ error: "body required" });
      return;
    }
    const author = req.body?.author === "agent" ? "agent" : "user";
    const id = uuidv4();
    tdb(req).prepare(
      `INSERT INTO ai_workflow_comments (id, workflow_id, author, body) VALUES (?, ?, ?, ?)`
    ).run(id, req.params.id, author, body);
    res.status(201).json(tdb(req).prepare(`SELECT * FROM ai_workflow_comments WHERE id = ?`).get(id));
  });

  // --- Workflow runs (durable pause/resume for the autonomous runner) ---
  router.get("/workflows/runs", (req, res) => {
    const status = req.query.status as string | undefined;
    const cardId = req.query.cardId as string | undefined;
    const agentId = req.query.agentId as string | undefined;
    const clauses: string[] = ["1=1"];
    const params: unknown[] = [];
    if (status) {
      clauses.push("r.status = ?");
      params.push(status);
    }
    if (cardId) {
      clauses.push("r.card_id = ?");
      params.push(cardId);
    }
    if (agentId) {
      clauses.push("w.agent_id = ?");
      params.push(agentId);
    }
    const rows = tdb(req)
      .prepare(
        `SELECT r.id, r.workflow_id, r.status, r.card_id, r.awaiting_node_id, r.error, r.created_at, r.updated_at
         FROM ai_workflow_runs r
         LEFT JOIN ai_workflows w ON w.id = r.workflow_id
         WHERE ${clauses.join(" AND ")} ORDER BY r.updated_at DESC LIMIT 100`
      )
      .all(...params);
    res.json({ runs: rows });
  });

  router.get("/workflows/runs/:id", (req, res) => {
    const row = tdb(req)
      .prepare(`SELECT * FROM ai_workflow_runs WHERE id = ?`)
      .get(req.params.id);
    if (!row) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    res.json(row);
  });

  router.post("/workflows/runs/:id/resume", (req, res) => {
    const run = tdb(req)
      .prepare(`SELECT id, status, card_id FROM ai_workflow_runs WHERE id = ?`)
      .get(req.params.id) as
      | { id: string; status: string; card_id: string | null }
      | undefined;
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    if (run.status !== "awaiting_input") {
      res.status(409).json({ error: `Run not awaiting input (status=${run.status})` });
      return;
    }
    const decision = req.body?.decision === "approve" ? "approve" : "request_changes";
    const comments = req.body?.comments ? String(req.body.comments) : undefined;
    // Persist the reviewer's comment to the card thread for the change branch.
    if (decision === "request_changes" && comments && run.card_id) {
      tdb(req).prepare(
        `INSERT INTO ai_card_comments (id, card_id, author, body) VALUES (?, ?, 'user', ?)`
      ).run(uuidv4(), run.card_id, comments);
    }
    // Enqueue the resume so it obeys the serial queue and never blocks the
    // request. The run lives in the caller's tenant DB, so route it back there.
    queue.enqueue({
      context: { resumeRunId: run.id, resumeDecision: { decision, comments } },
      priority: 3,
      tenantId: req.tenantId,
    });
    res.json({ ok: true });
  });

  router.post("/workflows/runs/:id/cancel", (req, res) => {
    const r = tdb(req)
      .prepare(
        `UPDATE ai_workflow_runs SET status = 'failed', error = 'cancelled', updated_at = datetime('now')
         WHERE id = ? AND status IN ('running','awaiting_input')`
      )
      .run(req.params.id);
    res.json({ ok: r.changes > 0 });
  });

  // Kick the durable autonomous executor immediately (instead of waiting for
  // its cron). No-op if a tick is already queued/running, so it never piles up.
  router.post("/autonomous/kick", (req, res) => {
    if (queue.hasPendingOrRunningWorkflow(AUTONOMOUS_RUNNER_ID)) {
      res.json({ ok: true, alreadyRunning: true });
      return;
    }
    const jobId = queue.enqueue({
      workflowId: AUTONOMOUS_RUNNER_ID,
      context: { autonomousTick: true, autoChainTick: 0 },
      priority: 1,
      tenantId: req.tenantId,
    });
    res.json({ ok: true, jobId });
  });

  router.get("/schedules", (req, res) => {
    res.json({ schedules: listSchedules(tdb(req)) });
  });

  router.post("/schedules", (req, res) => {
    const { workflowId, cronExpr, timezone, enabled } = req.body ?? {};
    if (!workflowId || !cronExpr) {
      res.status(400).json({ error: "workflowId and cronExpr required" });
      return;
    }
    const schedule = createSchedule(tdb(req), {
      workflowId: String(workflowId),
      cronExpr: String(cronExpr),
      timezone: timezone ? String(timezone) : undefined,
      enabled: enabled == null ? undefined : Boolean(enabled),
    });
    scheduler.reload();
    res.status(201).json(schedule);
  });

  router.put("/schedules/:id", (req, res) => {
    const { cronExpr, timezone, enabled } = req.body ?? {};
    const schedule = updateSchedule(tdb(req), req.params.id, {
      cronExpr: cronExpr == null ? undefined : String(cronExpr),
      timezone: timezone == null ? undefined : String(timezone),
      enabled: enabled == null ? undefined : Boolean(enabled),
    });
    if (!schedule) {
      res.status(404).json({ error: "Schedule not found" });
      return;
    }
    scheduler.reload();
    res.json(schedule);
  });

  router.delete("/schedules/:id", (req, res) => {
    const deleted = deleteSchedule(tdb(req), req.params.id);
    scheduler.reload();
    res.json({ ok: deleted });
  });

  // Resolve (or lazily create) the single board project owned by an agent. The
  // root 'intelligence' agent adopts the legacy 'default' project via the db
  // backfill; other agents get a fresh project that reuses the shared canonical
  // columns (backlog/in_progress/review/done) so the board UI keeps working.
  const ensureAgentProject = (agentId: string, db: AppDatabase): string => {
    const existing = db
      .prepare(`SELECT id FROM ai_projects WHERE agent_id = ? ORDER BY created_at ASC LIMIT 1`)
      .get(agentId) as { id: string } | undefined;
    if (existing) return existing.id;
    const agent = db
      .prepare(`SELECT name FROM ai_agents WHERE id = ?`)
      .get(agentId) as { name: string } | undefined;
    const id = agentId === "intelligence" ? "default" : uuidv4();
    const name = `${agent?.name ?? "Agent"} Tasks`;
    db.prepare(
      `INSERT OR IGNORE INTO ai_projects (id, name, agent_id) VALUES (?, ?, ?)`
    ).run(id, name, agentId);
    db.prepare(`UPDATE ai_projects SET agent_id = ? WHERE id = ?`).run(agentId, id);
    return id;
  };

  router.get("/projects", (req, res) => {
    const agentId = String(req.query.agentId ?? "intelligence");
    ensureAgentProject(agentId, tdb(req));
    const projects = tdb(req)
      .prepare(`SELECT * FROM ai_projects WHERE agent_id = ? ORDER BY updated_at DESC`)
      .all(agentId) as Array<{ id: string }>;
    const projectIds = projects.map((p) => p.id);
    // Columns are the shared canonical set; cards are scoped to the agent's projects.
    const columns = tdb(req)
      .prepare(`SELECT * FROM ai_project_columns ORDER BY sort_order ASC`)
      .all();
    const placeholders = projectIds.map(() => "?").join(",") || "''";
    const cards = projectIds.length
      ? tdb(req)
          .prepare(
            `SELECT * FROM ai_project_cards WHERE project_id IN (${placeholders}) ORDER BY sort_order ASC`
          )
          .all(...projectIds)
      : [];
    res.json({ projects, columns, cards });
  });

  router.post("/projects/cards", (req, res) => {
    const id = uuidv4();
    const {
      projectId,
      agentId,
      columnId,
      title,
      description,
      prompt,
      contextJson,
      tags,
      dueAt,
      linkedChatId,
      linkedWorkflowId,
      priority,
      parentCardId,
      status,
      assignedAgentId,
    } = req.body ?? {};
    // Project resolution order: explicit projectId → parent card's project →
    // the owning agent's board → legacy 'default'.
    let pid: string;
    if (projectId != null) {
      pid = String(projectId);
    } else if (parentCardId != null) {
      const parent = tdb(req)
        .prepare(`SELECT project_id FROM ai_project_cards WHERE id = ?`)
        .get(String(parentCardId)) as { project_id: string } | undefined;
      pid = parent?.project_id ?? ensureAgentProject(String(agentId ?? "intelligence"), tdb(req));
    } else {
      pid = ensureAgentProject(String(agentId ?? "intelligence"), tdb(req));
    }
    const cid = String(columnId ?? "backlog");
    const ctx =
      contextJson == null
        ? null
        : typeof contextJson === "string"
          ? contextJson
          : JSON.stringify(contextJson);
    const maxOrder = tdb(req)
      .prepare(`SELECT COALESCE(MAX(sort_order), -1) as m FROM ai_project_cards WHERE column_id = ?`)
      .get(cid) as { m: number };
    tdb(req).prepare(
      `INSERT INTO ai_project_cards (id, project_id, column_id, title, description, prompt, context_json, tags_json, due_at, linked_chat_id, linked_workflow_id, priority, parent_card_id, status, assigned_agent_id, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      pid,
      cid,
      String(title ?? "Untitled"),
      description ?? null,
      prompt ?? null,
      ctx,
      tags ?? null,
      dueAt ?? null,
      linkedChatId ?? null,
      linkedWorkflowId ?? null,
      priority != null ? Number(priority) : 2,
      parentCardId ?? null,
      status ?? null,
      assignedAgentId ?? null,
      maxOrder.m + 1
    );
    res.status(201).json(tdb(req).prepare(`SELECT * FROM ai_project_cards WHERE id = ?`).get(id));
  });

  router.patch("/projects/cards/:id", (req, res) => {
    const {
      columnId,
      sortOrder,
      title,
      description,
      prompt,
      contextJson,
      tags,
      dueAt,
      linkedChatId,
      linkedWorkflowId,
      priority,
      parentCardId,
      status,
      assignedAgentId,
    } = req.body ?? {};
    const nextColumnId = columnId != null ? String(columnId) : null;
    if (priority != null) {
      tdb(req).prepare(
        `UPDATE ai_project_cards SET priority = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(Number(priority), req.params.id);
    }
    if (parentCardId !== undefined) {
      tdb(req).prepare(
        `UPDATE ai_project_cards SET parent_card_id = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(parentCardId === null ? null : String(parentCardId), req.params.id);
    }
    if (status != null) {
      tdb(req).prepare(
        `UPDATE ai_project_cards SET status = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(String(status), req.params.id);
    }
    if (nextColumnId != null) {
      tdb(req).prepare(
        `UPDATE ai_project_cards SET column_id = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(nextColumnId, req.params.id);
      if (nextColumnId === "done" && status == null) {
        tdb(req).prepare(
          `UPDATE ai_project_cards SET status = 'done', updated_at = datetime('now') WHERE id = ?`
        ).run(req.params.id);
      }
    }
    if (sortOrder != null) {
      tdb(req).prepare(
        `UPDATE ai_project_cards SET sort_order = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(Number(sortOrder), req.params.id);
    }
    if (title != null) {
      tdb(req).prepare(
        `UPDATE ai_project_cards SET title = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(String(title), req.params.id);
    }
    if (description != null) {
      tdb(req).prepare(
        `UPDATE ai_project_cards SET description = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(String(description), req.params.id);
    }
    if (prompt != null) {
      tdb(req).prepare(
        `UPDATE ai_project_cards SET prompt = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(String(prompt), req.params.id);
    }
    if (contextJson != null) {
      const ctx =
        typeof contextJson === "string" ? contextJson : JSON.stringify(contextJson);
      tdb(req).prepare(
        `UPDATE ai_project_cards SET context_json = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(ctx, req.params.id);
    }
    if (tags != null) {
      tdb(req).prepare(
        `UPDATE ai_project_cards SET tags_json = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(String(tags), req.params.id);
    }
    if (dueAt != null) {
      tdb(req).prepare(
        `UPDATE ai_project_cards SET due_at = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(String(dueAt), req.params.id);
    }
    if (linkedChatId != null) {
      tdb(req).prepare(
        `UPDATE ai_project_cards SET linked_chat_id = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(String(linkedChatId), req.params.id);
    }
    if (linkedWorkflowId != null) {
      tdb(req).prepare(
        `UPDATE ai_project_cards SET linked_workflow_id = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(String(linkedWorkflowId), req.params.id);
    }
    if (assignedAgentId !== undefined) {
      tdb(req).prepare(
        `UPDATE ai_project_cards SET assigned_agent_id = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(assignedAgentId === null ? null : String(assignedAgentId), req.params.id);
    }
    const updatedCard = tdb(req)
      .prepare(`SELECT * FROM ai_project_cards WHERE id = ?`)
      .get(req.params.id) as
      | { id: string; column_id: string; status: string | null; project_id: string; assigned_agent_id: string | null }
      | undefined;
    // Emit a bus signal when a card reaches Done so any interested listener can
    // react (knowledge maintenance is owned by the Reflection engine).
    if (
      bus &&
      updatedCard &&
      (updatedCard.column_id === "done" || updatedCard.status === "accepted")
    ) {
      const owner =
        updatedCard.assigned_agent_id ??
        (
          tdb(req)
            .prepare(`SELECT agent_id FROM ai_projects WHERE id = ?`)
            .get(updatedCard.project_id) as { agent_id: string | null } | undefined
        )?.agent_id ??
        "intelligence";
      bus.emit("card_completed", { cardId: updatedCard.id, agentId: owner });
    }
    // Live ping so in-chat Active-Work panels reflect phase/status moves at once.
    broadcastCardActivity(req.tenantId, {
      cardId: req.params.id,
      agentId: updatedCard?.assigned_agent_id ?? null,
      reason: "card_updated",
    });
    res.json(updatedCard);
  });

  router.delete("/projects/cards/:id", (req, res) => {
    tdb(req).prepare(`DELETE FROM ai_project_cards WHERE id = ?`).run(req.params.id);
    res.json({ ok: true });
  });

  router.get("/projects/cards/:id/subtasks", (req, res) => {
    const db = tdb(req);
    reconcileParentProgress(db, req.params.id, req.tenantId);
    const rows = db
      .prepare(
        `SELECT * FROM ai_project_cards WHERE parent_card_id = ? ORDER BY sort_order ASC`
      )
      .all(req.params.id) as Array<{ column_id: string; status: string | null }>;
    const total = rows.length;
    const done = rows.filter(
      (r) => r.column_id === "done" || r.status === "accepted"
    ).length;
    res.json({ subtasks: rows, total, done, open: total - done });
  });

  router.get("/projects/cards/:id/comments", (req, res) => {
    const rows = tdb(req)
      .prepare(
        `SELECT id, card_id, author, body, kind, created_at FROM ai_card_comments
         WHERE card_id = ? ORDER BY created_at ASC`
      )
      .all(req.params.id);
    res.json({ comments: rows });
  });

  router.post("/projects/cards/:id/comments", (req, res) => {
    const body = String(req.body?.body ?? "").trim();
    if (!body) {
      res.status(400).json({ error: "body required" });
      return;
    }
    const author = req.body?.author === "agent" ? "agent" : "user";
    const id = uuidv4();
    tdb(req).prepare(
      `INSERT INTO ai_card_comments (id, card_id, author, body) VALUES (?, ?, ?, ?)`
    ).run(id, req.params.id, author, body);
    // Resolve the card's agent/chat so live panels can scope the refetch.
    const card = tdb(req)
      .prepare(
        `SELECT linked_chat_id, assigned_agent_id FROM ai_project_cards WHERE id = ?`
      )
      .get(req.params.id) as
      | { linked_chat_id: string | null; assigned_agent_id: string | null }
      | undefined;
    broadcastCardActivity(req.tenantId, {
      cardId: req.params.id,
      agentId: card?.assigned_agent_id ?? null,
      chatId: card?.linked_chat_id ?? null,
      reason: "comment",
    });
    res.status(201).json(tdb(req).prepare(`SELECT * FROM ai_card_comments WHERE id = ?`).get(id));
  });

  router.get("/training/jobs", (req, res) => {
    res.json({ jobs: training.listJobs() });
  });

  router.get("/training/config", (req, res) => {
    res.json({
      trainBaseModel: config.ai.trainBaseModel,
      llamaCppDir: config.ai.llamaCppDir,
      adaptersDir: config.ai.adaptersDir,
    });
  });

  router.get("/training/jobs/:id", (req, res) => {
    const job = training.getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(job);
  });

  router.post("/training/jobs", async (req, res) => {
    try {
      const id = await training.startJob(req.body ?? {});
      res.status(201).json({ id, job: training.getJob(id) });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post("/training/jobs/:id/cancel", (req, res) => {
    res.json({ ok: training.cancelJob() });
  });

  router.get("/datasets", (req, res) => {
    res.json({ datasets: tdb(req).prepare(`SELECT * FROM ai_datasets ORDER BY updated_at DESC`).all() });
  });

  router.post("/datasets", (req, res) => {
    const id = uuidv4();
    const { name, domain, path, rowCount } = req.body ?? {};
    if (!name || !path) {
      res.status(400).json({ error: "name and path required" });
      return;
    }
    tdb(req).prepare(
      `INSERT INTO ai_datasets (id, name, domain, path, row_count) VALUES (?, ?, ?, ?, ?)`
    ).run(id, String(name), domain ?? null, String(path), Number(rowCount ?? 0));
    res.status(201).json(tdb(req).prepare(`SELECT * FROM ai_datasets WHERE id = ?`).get(id));
  });

  const VALID_SOURCES: DatasetSource[] = ["chats", "workflows", "queue", "comments"];

  router.get("/datasets/sources", (req, res) => {
    res.json({ sources: datasetBuilderFor(req).listSources() });
  });

  router.get("/datasets/chats", (req, res) => {
    res.json({ chats: datasetBuilderFor(req).listChats() });
  });

  router.get("/datasets/preview", (req, res) => {
    const source = String(req.query.source ?? "") as DatasetSource;
    if (!VALID_SOURCES.includes(source)) {
      res.status(400).json({ error: "Invalid source" });
      return;
    }
    const limit = Number(req.query.limit ?? 50);
    try {
      res.json(datasetBuilderFor(req).previewSource(source, { limit }));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/datasets/build", (req, res) => {
    const { name, domain, source, chatIds, limit } = req.body ?? {};
    if (!name || !String(name).trim()) {
      res.status(400).json({ error: "name required" });
      return;
    }
    if (!VALID_SOURCES.includes(source)) {
      res.status(400).json({ error: "Invalid source" });
      return;
    }
    try {
      const row = datasetBuilderFor(req).buildDataset({
        name: String(name),
        domain: domain ? String(domain) : undefined,
        source,
        chatIds: Array.isArray(chatIds) ? chatIds.map(String) : undefined,
        limit: limit != null ? Number(limit) : undefined,
      });
      res.status(201).json(row);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // --- Per-agent calendar (Google-Calendar-like events + derived activity) ---
  const CALENDAR_KINDS = new Set(["event", "task", "appointment"]);

  router.get("/calendar/events", (req, res) => {
    const agentId = String(req.query.agentId ?? "intelligence");
    const from = req.query.from ? String(req.query.from) : undefined;
    const to = req.query.to ? String(req.query.to) : undefined;
    const clauses: string[] = ["agent_id = ?"];
    const params: unknown[] = [agentId];
    if (from) {
      clauses.push("start_at >= ?");
      params.push(from);
    }
    if (to) {
      clauses.push("start_at <= ?");
      params.push(to);
    }
    const events = tdb(req)
      .prepare(
        `SELECT * FROM ai_calendar_events WHERE ${clauses.join(" AND ")} ORDER BY start_at ASC`
      )
      .all(...params);
    res.json({ events });
  });

  router.post("/calendar/events", (req, res) => {
    const {
      agentId,
      kind,
      title,
      description,
      start_at,
      end_at,
      all_day,
      location,
      linked_card_id,
      linked_run_id,
      status,
    } = req.body ?? {};
    if (!title || !String(title).trim() || !start_at || !String(start_at).trim()) {
      res.status(400).json({ error: "title and start_at required" });
      return;
    }
    const id = uuidv4();
    const k = CALENDAR_KINDS.has(String(kind)) ? String(kind) : "event";
    tdb(req).prepare(
      `INSERT INTO ai_calendar_events
         (id, agent_id, kind, title, description, start_at, end_at, all_day, location, linked_card_id, linked_run_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      String(agentId ?? "intelligence"),
      k,
      String(title),
      description ?? null,
      String(start_at),
      end_at ?? null,
      all_day ? 1 : 0,
      location ?? null,
      linked_card_id ?? null,
      linked_run_id ?? null,
      status ? String(status) : "scheduled"
    );
    res.status(201).json(tdb(req).prepare(`SELECT * FROM ai_calendar_events WHERE id = ?`).get(id));
  });

  router.patch("/calendar/events/:id", (req, res) => {
    const { title, description, start_at, end_at, all_day, location, kind, status } =
      req.body ?? {};
    if (title != null) {
      tdb(req).prepare(
        `UPDATE ai_calendar_events SET title = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(String(title), req.params.id);
    }
    if (description !== undefined) {
      tdb(req).prepare(
        `UPDATE ai_calendar_events SET description = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(description === null ? null : String(description), req.params.id);
    }
    if (start_at != null) {
      tdb(req).prepare(
        `UPDATE ai_calendar_events SET start_at = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(String(start_at), req.params.id);
    }
    if (end_at !== undefined) {
      tdb(req).prepare(
        `UPDATE ai_calendar_events SET end_at = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(end_at === null ? null : String(end_at), req.params.id);
    }
    if (all_day != null) {
      tdb(req).prepare(
        `UPDATE ai_calendar_events SET all_day = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(all_day ? 1 : 0, req.params.id);
    }
    if (location !== undefined) {
      tdb(req).prepare(
        `UPDATE ai_calendar_events SET location = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(location === null ? null : String(location), req.params.id);
    }
    if (kind != null && CALENDAR_KINDS.has(String(kind))) {
      tdb(req).prepare(
        `UPDATE ai_calendar_events SET kind = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(String(kind), req.params.id);
    }
    if (status != null) {
      tdb(req).prepare(
        `UPDATE ai_calendar_events SET status = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(String(status), req.params.id);
    }
    res.json(tdb(req).prepare(`SELECT * FROM ai_calendar_events WHERE id = ?`).get(req.params.id));
  });

  router.delete("/calendar/events/:id", (req, res) => {
    tdb(req).prepare(`DELETE FROM ai_calendar_events WHERE id = ?`).run(req.params.id);
    res.json({ ok: true });
  });

  // Read-only timeline activity derived from real agent work: workflow runs
  // (joined to their owning agent via ai_workflows) plus optional due cards.
  router.get("/calendar/activity", (req, res) => {
    const agentId = String(req.query.agentId ?? "intelligence");
    const from = req.query.from ? String(req.query.from) : undefined;
    const to = req.query.to ? String(req.query.to) : undefined;

    const runClauses: string[] = ["w.agent_id = ?"];
    const runParams: unknown[] = [agentId];
    if (from) {
      runClauses.push("COALESCE(r.finished_at, r.updated_at, r.created_at) >= ?");
      runParams.push(from);
    }
    if (to) {
      runClauses.push("COALESCE(r.started_at, r.created_at) <= ?");
      runParams.push(to);
    }
    const runs = tdb(req)
      .prepare(
        `SELECT r.id, r.workflow_id, r.status, r.trigger_input, r.awaiting_node_id,
                r.card_id, r.result_json, r.error, r.created_at, r.started_at,
                r.finished_at, r.updated_at, w.name AS workflow_name
         FROM ai_workflow_runs r
         JOIN ai_workflows w ON w.id = r.workflow_id
         WHERE ${runClauses.join(" AND ")}
         ORDER BY COALESCE(r.started_at, r.created_at) ASC LIMIT 500`
      )
      .all(...runParams);

    const cardClauses: string[] = ["assigned_agent_id = ?", "due_at IS NOT NULL"];
    const cardParams: unknown[] = [agentId];
    if (from) {
      cardClauses.push("due_at >= ?");
      cardParams.push(from);
    }
    if (to) {
      cardClauses.push("due_at <= ?");
      cardParams.push(to);
    }
    const cards = tdb(req)
      .prepare(
        `SELECT * FROM ai_project_cards WHERE ${cardClauses.join(" AND ")} ORDER BY due_at ASC LIMIT 500`
      )
      .all(...cardParams);

    res.json({ runs, cards });
  });

  return router;
}
