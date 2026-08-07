import { Router, type Request, type Response } from "express";
import { v4 as uuidv4 } from "uuid";
import type { EventEmitter } from "node:events";
import { config } from "../config.js";
import { requireEditorForMutation } from "../services/auth/middleware.js";
import {
  assertSpendAllowed,
  isSpendAuthorityError,
} from "../services/authority/spend-authority.js";
import {
  assertAgentExecutionAllowed,
  isAgentPauseAuthorityError,
} from "../services/authority/agent-pause-authority.js";
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
import { getEmbedQueueMetrics } from "../services/embeddings/embed-queue.js";
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
  resolveVaultOwnerInput,
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
import { globFiles, listDir, resolveCodingRoot } from "../services/coding/fs-tools.js";
import { codingUiAllowed } from "../services/coding/coding-ui-access.js";
import { enrichPlatformContextWithGit } from "../services/coding/git-workspace.js";
import { createCodingWorkspaceRouter } from "./coding-workspace.js";
import {
  collectCursorMcpDiscovery,
  enrichPlatformContextWithMcp,
  resolveMcpDiscoveryExecution,
  resolveMcpFromWorkspace,
} from "../services/coding/cursor-mcp-config.js";
import { resolveCursorSettingSources } from "../services/agents/cursor-cloud-backend.js";
import { syncCursorWorkspaceKnowledge } from "../services/knowledge-store.js";
import type { AiAgent } from "../services/agents/types.js";
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
  getSharedChatSession,
  listSharedChatSessionsForUser,
  type CoreSharedChatSession,
  type ShareGrantRole,
} from "../core-db.js";
import { resolveShareAccess } from "../services/share-service.js";
import { refreshScheduler } from "../services/scheduler.js";
import { getTenantDb } from "../tenant-registry.js";
import { getShareBroker, broadcastCardActivity } from "../ws-broker.js";
import { createRecord, KernelError } from "../kernel/record-api.js";
import type { OperationContext } from "../kernel/adapter-registry.js";
import { ensureAgentProject } from "../services/user-productivity.js";

export type { PlatformContext } from "../types/platform-context.js";
import type { PlatformContext } from "../types/platform-context.js";

function maybeSyncCursorWorkspaceKnowledge(
  db: AppDatabase,
  agent: AiAgent | null | undefined,
  tenantId: string | null | undefined,
  workspace?: string
): void {
  if (!agent || agent.backend === "cursor_cloud") return;
  const root = resolveCodingRoot({
    tenantId,
    root: workspace?.trim() || undefined,
  });
  syncCursorWorkspaceKnowledge(db, root);
}

function mcpExecutionForAgent(
  agent: AiAgent | null | undefined,
  opts?: { tenantId?: string | null; workspace?: string }
) {
  const cwd = resolveCodingRoot({
    tenantId: opts?.tenantId,
    root: opts?.workspace?.trim() || undefined,
  });
  const mcpFromWorkspace =
    agent?.backend === "cursor_cloud"
      ? resolveMcpFromWorkspace(
          agent.config as { mcpFromWorkspace?: unknown },
          { isSaas: config.isSaas }
        )
      : false;
  return resolveMcpDiscoveryExecution({
    backend: agent?.backend,
    mcpFromWorkspace,
    hasProjectSettingSources:
      resolveCursorSettingSources(cwd).includes("project"),
  });
}

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
  router.use("/coding", createCodingWorkspaceRouter(tdb));
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
      res.json({ enabled: false, enabledOverride: null, embedder: null, profiles: [] });
      return;
    }
    res.json(embeddings.getStatus());
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
    let codeChunks = 0;
    let codeEmbedded = 0;
    try {
      const row = tdb(req)
        .prepare(
          `SELECT COUNT(*) AS n,
                  SUM(CASE WHEN embedding IS NOT NULL THEN 1 ELSE 0 END) AS e
           FROM code_chunks`
        )
        .get() as { n: number; e: number } | undefined;
      codeChunks = row?.n ?? 0;
      codeEmbedded = row?.e ?? 0;
    } catch {
      /* schema may not exist yet */
    }

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
      codeCoverage: {
        chunks: codeChunks,
        embedded: codeEmbedded,
      },
      ftsCoverage: {
        total: activeMemories,
        indexed: ftsIndexed,
      },
      ragTopK: config.embeddings.ragTopK,
      wikiRagTopK: config.embeddings.wikiRagTopK,
      codeRagTopK: config.embeddings.codeRagTopK,
      profiles: (embeddingStatus?.profiles ?? []).map((p) => ({
        id: p.id,
        label: p.label,
        ready: p.ready,
        dim: p.dim,
      })),
      queue: getEmbedQueueMetrics(),
      embedderLogTail: embeddingStatus?.embedder.logs.slice(-20) ?? [],
    });
  });

  router.get("/models", (req, res) => {
    res.json({ models: llm.scanModels() });
  });

  router.get("/coding/mention-paths", (req, res) => {
    if (!codingUiAllowed()) {
      res.json({ paths: [], codingDisabled: true });
      return;
    }
    const q = String(req.query.q ?? "")
      .trim()
      .toLowerCase()
      .replace(/\\/g, "/");
    const limit = Math.min(Number(req.query.limit ?? 40), 80);
    const agentId = String(req.query.agentId ?? "intelligence");
    const agent = getAgent(tdb(req), agentId);
    const agentWorkspace =
      agent?.config &&
      typeof (agent.config as { workspace?: unknown }).workspace === "string"
        ? String((agent.config as { workspace: string }).workspace).trim()
        : "";
    const fsRoot = {
      tenantId: req.tenantId,
      root: agentWorkspace || undefined,
    };
    const matches: Array<{ path: string; type: "file" | "dir" }> = [];
    if (!q) {
      const root = listDir({ path: ".", recursive: false, ...fsRoot });
      for (const e of root.entries.slice(0, limit)) {
        matches.push({
          path: e.name,
          type: e.type === "dir" ? "dir" : "file",
        });
      }
      res.json({ paths: matches });
      return;
    }
    const glob = globFiles({ pattern: `**/*${q}*`, ...fsRoot });
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

  // Everything that goes to the model: resolved system prompt template, the
  // sampling params, the launch command, the (empty) tool set, and a snapshot
  // of the last actual request. Lets the UI show "what is sent to the LLM".
  router.get("/inspect", (req, res) => {
    const settings = llm.getSettings();
    const pathname = (req.query.pathname as string) || undefined;
    const agentId = String(req.query.agentId ?? "intelligence");
    const agent = getAgent(tdb(req), agentId);
    const agentWorkspace =
      agent?.config &&
      typeof (agent.config as { workspace?: unknown }).workspace === "string"
        ? String((agent.config as { workspace?: string }).workspace)
        : undefined;
    maybeSyncCursorWorkspaceKnowledge(
      tdb(req),
      agent,
      req.tenantId,
      agentWorkspace
    );
    const previewCtx = enrichPlatformContextWithMcp(
      enrichPlatformContextWithGit(
        pathname ? { pathname, breadcrumb: [] } : undefined,
        { tenantId: req.tenantId, workspace: agentWorkspace }
      ),
      {
        tenantId: req.tenantId,
        workspace: agentWorkspace,
        execution: mcpExecutionForAgent(agent, {
          tenantId: req.tenantId,
          workspace: agentWorkspace,
        }),
      }
    );
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

  router.get("/rules", (req, res) => {
    const agentId = agentIdFromRequest(req);
    const agentDb = agentDbFromRequest(req, res, agentId, "viewer");
    if (!agentDb) return;
    res.json({ rules: listAiRules(agentDb, agentId) });
  });

  router.get("/skills", (req, res) => {
    const includeBody = req.query.body === "1";
    const agentId = agentIdFromRequest(req);
    const agentDb = agentDbFromRequest(req, res, agentId, "viewer");
    if (!agentDb) return;
    res.json({ skills: listAiSkills(agentDb, includeBody, agentId) });
  });

  router.post("/workspace-knowledge/import", (req, res) => {
    const agentId = agentIdFromRequest(req);
    const agentDb = agentDbFromRequest(req, res, agentId, "editor");
    if (!agentDb) return;
    const agent = getAgent(tdb(req), agentId);
    if (agent?.backend === "cursor_cloud") {
      res.json({
        rules: 0,
        skills: 0,
        synced: false,
        message:
          "Workspace knowledge import is not available for Cursor Cloud agents; project instructions load via SDK settingSources.",
      });
      return;
    }
    const agentWorkspace =
      agent?.config &&
      typeof (agent.config as { workspace?: unknown }).workspace === "string"
        ? String((agent.config as { workspace: string }).workspace)
        : undefined;
    const root = resolveCodingRoot({
      tenantId: req.tenantId,
      root: agentWorkspace?.trim() || undefined,
    });
    const result = syncCursorWorkspaceKnowledge(agentDb, root, { force: true });
    res.json(result);
  });

  router.get("/mcp", (req, res) => {
    const agentId = agentIdFromRequest(req);
    const agent = getAgent(tdb(req), agentId);
    const cfg = (agent?.config ?? {}) as {
      workspace?: unknown;
      mcpFromWorkspace?: unknown;
      mcpDisabledServers?: unknown;
    };
    const agentWorkspace =
      typeof cfg.workspace === "string" ? cfg.workspace : undefined;
    const root = resolveCodingRoot({
      tenantId: req.tenantId,
      root: agentWorkspace?.trim() || undefined,
    });
    const mcpFromWorkspace =
      agent?.backend === "cursor_cloud"
        ? resolveMcpFromWorkspace(
            { mcpFromWorkspace: cfg.mcpFromWorkspace },
            { isSaas: config.isSaas }
          )
        : false;
    const disabled = Array.isArray(cfg.mcpDisabledServers)
      ? cfg.mcpDisabledServers.filter((n): n is string => typeof n === "string")
      : [];
    const disabledSet = new Set(disabled);
    const discovery = collectCursorMcpDiscovery(root, {
      execution: mcpExecutionForAgent(agent, {
        tenantId: req.tenantId,
        workspace: agentWorkspace,
      }),
    });
    const settingSources = resolveCursorSettingSources(root);
    res.json({
      workspace: root,
      sourcePath: discovery?.sourcePath ?? null,
      summary: discovery?.summary ?? null,
      mcpFromWorkspace,
      backend: agent?.backend ?? null,
      settingSources,
      projectInstructions:
        agent?.backend === "cursor_cloud"
          ? settingSources.includes("project")
            ? "sdk"
            : "none"
          : "knowledge",
      servers: (discovery?.servers ?? []).map((s) => ({
        ...s,
        enabled: !disabledSet.has(s.name),
      })),
    });
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

  router.get("/agents/:id/accounts", (req, res) => {
    const scope = resolveAgentScope(req, req.params.id, "viewer");
    if (!scope) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ accounts: listAgentAccounts(scope.db, req.params.id) });
  });

  router.get("/agents/:id/reflection", (req, res) => {
    const scope = resolveAgentScope(req, req.params.id, "viewer");
    if (!scope) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ reflection: getReflectionConfig(scope.db, req.params.id) });
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

  router.get("/secrets", (req, res) => {
    // Managed Connect-card keys are hidden from the generic list.
    const agentIdRaw = req.query.agentId;
    const ownerKindRaw = req.query.ownerKind;
    let owner;
    try {
      owner = resolveVaultOwnerInput({
        ownerKind: typeof ownerKindRaw === "string" ? ownerKindRaw : undefined,
        agentId:
          typeof agentIdRaw === "string" && agentIdRaw.trim()
            ? agentIdRaw.trim()
            : null,
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    const secrets = listSecrets(tdb(req), owner).filter(
      (s) =>
        s.id !== "cursor-api-key" &&
        !s.id.startsWith("cursor-api-key__agent__") &&
        s.name !== "cursor_api_key" &&
        s.name !== "CURSOR_API_KEY" &&
        s.id !== "openai-api-key" &&
        !s.id.startsWith("openai-api-key__agent__") &&
        s.name !== "openai_api_key" &&
        s.id !== "anthropic-api-key" &&
        !s.id.startsWith("anthropic-api-key__agent__") &&
        s.name !== "anthropic_api_key" &&
        s.id !== "openrouter-api-key" &&
        !s.id.startsWith("openrouter-api-key__agent__") &&
        s.name !== "openrouter_api_key" &&
        s.id !== "groq-api-key" &&
        !s.id.startsWith("groq-api-key__agent__") &&
        s.name !== "groq_api_key" &&
        s.id !== "together-api-key" &&
        !s.id.startsWith("together-api-key__agent__") &&
        s.name !== "together_api_key" &&
        s.id !== "fireworks-api-key" &&
        !s.id.startsWith("fireworks-api-key__agent__") &&
        s.name !== "fireworks_api_key" &&
        s.id !== "deepseek-api-key" &&
        !s.id.startsWith("deepseek-api-key__agent__") &&
        s.name !== "deepseek_api_key" &&
        s.id !== "google-ai-api-key" &&
        !s.id.startsWith("google-ai-api-key__agent__") &&
        s.name !== "google_ai_api_key" &&
        s.id !== "xai-api-key" &&
        !s.id.startsWith("xai-api-key__agent__") &&
        s.name !== "xai_api_key" &&
        s.id !== "zai-api-key" &&
        !s.id.startsWith("zai-api-key__agent__") &&
        s.name !== "zai_api_key" &&
        s.id !== "minimax-api-key" &&
        !s.id.startsWith("minimax-api-key__agent__") &&
        s.name !== "minimax_api_key" &&
        s.id !== "custom-openai-api-key" &&
        !s.id.startsWith("custom-openai-api-key__agent__") &&
        s.name !== "custom_openai_api_key" &&
        s.id !== "custom-openai-base-url" &&
        !s.id.startsWith("custom-openai-base-url__agent__") &&
        s.name !== "custom_openai_base_url" &&
        s.id !== "zai-coding-api-key" &&
        !s.id.startsWith("zai-coding-api-key__agent__") &&
        s.name !== "zai_coding_api_key" &&
        s.id !== "opencode-go-api-key" &&
        !s.id.startsWith("opencode-go-api-key__agent__") &&
        s.name !== "opencode_go_api_key" &&
        s.id !== "digitalocean-inference-api-key" &&
        !s.id.startsWith("digitalocean-inference-api-key__agent__") &&
        s.name !== "digitalocean_inference_api_key" &&
        s.id !== "snowflake-cortex-api-key" &&
        !s.id.startsWith("snowflake-cortex-api-key__agent__") &&
        s.name !== "snowflake_cortex_api_key" &&
        s.id !== "snowflake-cortex-base-url" &&
        !s.id.startsWith("snowflake-cortex-base-url__agent__") &&
        s.name !== "snowflake_cortex_base_url" &&
        s.id !== "minimax-token-api-key" &&
        !s.id.startsWith("minimax-token-api-key__agent__") &&
        s.name !== "minimax_token_api_key" &&
        s.id !== "kimi-code-api-key" &&
        !s.id.startsWith("kimi-code-api-key__agent__") &&
        s.name !== "kimi_code_api_key" &&
        s.id !== "poe-api-key" &&
        !s.id.startsWith("poe-api-key__agent__") &&
        s.name !== "poe_api_key" &&
        s.id !== "opencode-zen-api-key" &&
        !s.id.startsWith("opencode-zen-api-key__agent__") &&
        s.name !== "opencode_zen_api_key"
    );
    res.json({ secrets });
  });

  router.get("/cursor/status", async (req, res) => {
    const db = tdb(req);
    const agentIdRaw = req.query.agentId;
    const agentId =
      typeof agentIdRaw === "string" && agentIdRaw.trim()
        ? agentIdRaw.trim()
        : null;
    normalizeCursorVaultSecret(db);
    const status = getCursorAuthStatus(db, agentId);
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

  router.get("/cursor/models", async (req, res) => {
    try {
      const agentIdRaw = req.query.agentId;
      const agentId =
        typeof agentIdRaw === "string" && agentIdRaw.trim()
          ? agentIdRaw.trim()
          : null;
      const models = await listCursorSubscriptionModels(tdb(req), agentId);
      res.json({ models });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
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

    try {
      assertSpendAllowed({
        tenantId: req.tenantId ?? scope.tenantId,
        userId: req.user?.id,
        agentId: resolvedAgentId,
        action: "ai_chat",
      });
    } catch (err) {
      if (isSpendAuthorityError(err)) {
        res.status(err.status).json({
          error: err.message,
          code: err.code,
          spendDisabled: true,
        });
        return;
      }
      throw err;
    }

    try {
      assertAgentExecutionAllowed({
        tenantId: req.tenantId ?? scope.tenantId,
        userId: req.user?.id,
        agentId: resolvedAgentId,
        action: "ai_chat",
      });
    } catch (err) {
      if (isAgentPauseAuthorityError(err)) {
        res.status(err.status).json({
          error: err.message,
          code: err.code,
          agentPaused: true,
        });
        return;
      }
      throw err;
    }

    let agent;
    try {
      agent = resolveAgent(scope.db, resolvedAgentId, {
        tenantId: req.tenantId ?? scope.tenantId,
        userId: req.user?.id,
        action: "ai_chat",
      });
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : "Agent not found" });
      return;
    }

    if (!llm.isReady() && !agentCanRunWithoutLocalLlm(agent.backend, scope.db, agent.id)) {
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
    const chatKernelContext: OperationContext = {
      tenantId: work.tenantId,
      userId: req.user!.id,
      isAdmin: req.user!.isAdmin,
      role: req.tenantRole ?? "editor",
      source: "http",
      bus,
    };
    // Contribute-back: mirror new memories into the owner's engine DB only when
    // the caller opts in AND the agent is shared (no-op for owned agents).
    const contributeDb =
      contributeMemory && !scope.owned ? engineDb : undefined;

    let activeChatId = chatId;
    let userMsgId: string;
    try {
      if (!activeChatId) {
        const title = message.trim().slice(0, 80) || "New chat";
        activeChatId = createRecord(
          workDb,
          "ChatSession",
          { title },
          chatKernelContext
        ).id;
      }

      userMsgId = createRecord(
        workDb,
        "ChatMessage",
        {
          chat_id: activeChatId,
          role: "user",
          content: { text: message, images },
        },
        chatKernelContext
      ).id;
    } catch (err) {
      if (err instanceof KernelError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
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
    const agentWorkspace =
      typeof (agent.config as { workspace?: unknown } | undefined)?.workspace ===
      "string"
        ? String((agent.config as { workspace?: string }).workspace)
        : undefined;
    maybeSyncCursorWorkspaceKnowledge(
      engineDb,
      agent,
      req.tenantId,
      agentWorkspace
    );
    const platformContextEnriched = enrichPlatformContextWithMcp(
      enrichPlatformContextWithGit(platformContext, {
        tenantId: req.tenantId,
        workspace: agentWorkspace,
      }),
      {
        tenantId: req.tenantId,
        workspace: agentWorkspace,
        execution: mcpExecutionForAgent(agent, {
          tenantId: req.tenantId,
          workspace: agentWorkspace,
        }),
      }
    );
    const assembled = assemblePrompt(engineDb, {
      basePrompt: agent.systemPrompt,
      platformContext: platformContextEnriched,
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
    const { messages: compactedHistory, droppedTurns, scratchpad } =
      compactAgentMessages(historyAgentMessages, ctxBudget);
    if (droppedTurns > 0 && activeChatId && memoryMaintenance) {
      // Compaction erased turns — enqueue distill so episodic knowledge survives.
      memoryMaintenance.enqueueDistill({
        chatId: activeChatId,
        agentId: agent.id,
        tenantId: work.tenantId,
      });
    }

    const systemPromptWithScratchpad = scratchpad
      ? `${systemPrompt}\n\n${scratchpad}`
      : systemPrompt;

    const messages: ChatMessage[] = [
      { role: "system", content: systemPromptWithScratchpad },
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
      systemPrompt: systemPromptWithScratchpad,
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
    send("status", {
      phase: "starting",
      message:
        agent.backend === "cursor_cloud" || agent.backend === "cursor"
          ? "Starting Cursor…"
          : "Starting model…",
    });

    const abortController = new AbortController();
    const onClientClose = () => abortController.abort();
    req.on("close", onClientClose);
    res.on("close", onClientClose);

    let fullContent = "";
    let reasoningRaw = "";
    let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    let sawStreamActivity = false;
    const markStreamActivity = () => {
      sawStreamActivity = true;
    };
    const statusHeartbeat = setInterval(() => {
      if (abortController.signal.aborted || sawStreamActivity) return;
      send("status", {
        phase: "waiting",
        message:
          agent.backend === "cursor_cloud" || agent.backend === "cursor"
            ? "Waiting on Cursor…"
            : "Waiting on model…",
      });
    }, 4000);
    abortController.signal.addEventListener("abort", () => {
      clearInterval(statusHeartbeat);
    });

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
            embedder: embeddings?.isEmbedderReady("code")
              ? embeddings.getEmbeddingClient("code")
              : embeddings?.isEmbedderReady("memory")
                ? embeddings.getEmbeddingClient("memory")
                : undefined,
            activeAgentId: agent.id,
            userId: req.user?.id,
            tenantId: work.tenantId,
            sessionAutonomy,
            abortSignal: abortController.signal,
            onTerminalOutput: (chunk) => {
              send("terminal_output", {
                toolCallId: chunk.toolCallId,
                stream: chunk.stream,
                text: chunk.text,
              });
            },
            onTerminalMonitor: (chunk) => {
              send("terminal_monitor", {
                toolCallId: chunk.toolCallId,
                sessionId: chunk.sessionId,
                text: chunk.text,
              });
            },
          },
          abortSignal: abortController.signal,
          maxIterations: harnessProfile.maxChatIterations,
          onToken: (chunk) => {
            markStreamActivity();
            clearInterval(statusHeartbeat);
            streamed += chunk;
            segRaw += chunk;
            send("token", { content: chunk });
          },
          onReasoning: (chunk) => {
            markStreamActivity();
            clearInterval(statusHeartbeat);
            partReasoning(chunk);
            send("reasoning", { content: chunk });
          },
          onToolCall: (name, args, toolCallId) => {
            markStreamActivity();
            clearInterval(statusHeartbeat);
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
          onTerminalMonitor: (toolCallId, chunk) => {
            send("terminal_monitor", { toolCallId, ...chunk });
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
            const { previewWriteToolDiff } = await import(
              "../services/coding/fs-tools.js"
            );
            const { previewGitToolDiff } = await import(
              "../services/coding/git-tools.js"
            );
            const preview = {
              ...previewWriteToolDiff(name, args, {
                tenantId: work.tenantId,
              }),
              ...previewGitToolDiff(name, args, {
                tenantId: work.tenantId,
              }),
            };
            send("tool_confirm_required", {
              toolCallId,
              name,
              args,
              ...preview,
            });
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
      const assistantMsgId = createRecord(
        workDb,
        "ChatMessage",
        {
          chat_id: activeChatId,
          role: "assistant",
          content: { content: fullContent, thinking, answer, parts },
        },
        chatKernelContext
      ).id;

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
      clearInterval(statusHeartbeat);
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

  router.get("/adapters", (req, res) => {
    const rows = tdb(req).prepare(`SELECT * FROM ai_adapters ORDER BY name ASC`).all();
    res.json({ adapters: rows });
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

  router.get("/workflows/:id/comments", (req, res) => {
    const rows = tdb(req)
      .prepare(
        `SELECT id, workflow_id, author, body, created_at FROM ai_workflow_comments
         WHERE workflow_id = ? ORDER BY created_at ASC`
      )
      .all(req.params.id);
    res.json({ comments: rows });
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

  router.get("/schedules", (req, res) => {
    res.json({ schedules: listSchedules(tdb(req)) });
  });

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

  router.get("/datasets", (req, res) => {
    res.json({ datasets: tdb(req).prepare(`SELECT * FROM ai_datasets ORDER BY updated_at DESC`).all() });
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
