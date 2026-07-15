import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import type { AppDatabase } from "../db.js";
import { config } from "../config.js";
import { loadSkillBody, createSkillFile, listAiSkills } from "./ai-skills.js";
import { gateSkillDraft } from "./skill-quality.js";
import { createRuleFile } from "./ai-rules.js";
import {
  saveArtifact,
  readArtifact,
  listArtifacts,
  deleteArtifact,
} from "./ai-artifacts.js";
import { AI_TOOL_REGISTRY } from "./ai-tools-registry.js";
import { executePluginTool, isPluginToolName, pluginToolsAsAiDefs, type PluginToolExecContext } from "../plugins/plugin-tools.js";
import type { LlmManager } from "./llm-manager.js";
import { runSubagent } from "./agents/runner.js";
import { runCursorAgent } from "./agents/cursor-backend.js";
import { buildContractorContextBundle } from "./contractor-context.js";
import { createAgent, getAgent, listAgents } from "./agents/agents-db.js";
import { objectTypeAutoToolDefs } from "../kernel/auto-tools.js";
import type { OperationContext } from "../kernel/adapter-registry.js";
import {
  executeKernelTool,
  isKernelToolName,
  KernelError,
  objectTypeForKernelTool,
} from "../kernel/tool-exec.js";
import { isRegisteredPageKind } from "../kernel/kind-registry.js";
import { getCoreDb } from "../core-db.js";
import { broadcastCardActivity } from "../ws-broker.js";
import {
  advanceSubtaskOnResultComment,
  reconcileParentProgress,
} from "./card-progress.js";
import type { MarketplaceListingKind, ShareGrantRole } from "../core-db.js";
import {
  buildSharedSidebarTree,
  createShareGrant,
  listShareGrantsForUser,
  revokeShareGrant,
  ShareError,
} from "./share-service.js";
import {
  createInferenceEndpoint,
  findActiveEndpointByModelPath,
} from "./inference-service.js";
import {
  createWorkflow,
  listWorkflows,
  updateWorkflow,
  type WorkflowGraph,
} from "./ai-workflows.js";
import {
  createSchedule,
  listSchedules,
  reloadAiSchedules,
} from "./ai-scheduler.js";
import {
  assertPlatformAction,
  logPlatformAction,
  type PlatformScope,
} from "./platform-scope.js";
import { getAssignment } from "./ai-agent-assignments.js";
import { getUserOwnerTenantDb } from "./user-scope.js";
import { ensureUserProject, ensureAgentProject } from "./user-productivity.js";
import {
  readFile as fsReadFile,
  writeFile as fsWriteFile,
  editFile as fsEditFile,
  deleteFile as fsDeleteFile,
  listDir as fsListDir,
  globFiles,
  grepSearch,
  applyPatch,
  computeUnifiedDiff,
  revertFile,
  readFileRaw,
} from "./coding/fs-tools.js";
import { runTerminal } from "./coding/terminal-service.js";
import { codebaseSearch } from "./coding/codebase-search.js";
import { readDiagnostics } from "./coding/read-diagnostics.js";
import { logToolAudit } from "./coding/tool-audit.js";
import {
  createNotification,
  listNotificationsForAgent,
  listNotificationsForUser,
  markAllRead,
  markRead,
} from "./notification-service.js";
import {
  addMessage as addSupportMessage,
  createTicket,
  getTicket,
  listAllTickets,
  listTicketsForRequester,
  updateTicket,
} from "./support-service.js";
import {
  createPage as createWikiPage,
  deletePage as deleteWikiPage,
  getPageById,
  getPageBySlug,
  listPages as listWikiPages,
  updatePage as updateWikiPage,
  type WikiScope,
} from "./wiki-service.js";
import {
  createConversation,
  createMessage as createDmMessage,
  getConversationForUser,
  listConversationsForUser,
  listMessages as listDmMessages,
} from "./dm-service.js";
import {
  createHook,
  deleteHook,
  listHookRuns,
  listHooks,
  updateHook,
  type HookOwnerScope,
} from "./hook-service.js";
import { refreshScheduler } from "./scheduler.js";
import { emitEvent, listEventsForOwner } from "./event-bus.js";
import { createFinancialServices } from "../routes/financial.js";
import { installCatalogEntry } from "./marketplace-catalog.js";
import {
  listAvailablePlugins,
  listInstalledPlugins,
  installedPluginIdsForTenant,
} from "../plugins/plugin-install.js";
import { activatePluginForTenant } from "../plugins/activate-plugin.js";
import { scaffoldPlugin, prepareMarketplaceSubmission, defaultPluginRoot } from "./plugin-scaffold.js";
import { buildPluginWithEsbuild } from "./plugin-build.js";
import { indexMemory, removeMemoryFromIndex } from "./embeddings/memory-embeddings.js";
import { exportEntity } from "./portability.js";
import { listInferenceEndpoints } from "./inference-service.js";
import type { AiQueueWorker } from "./ai-queue-worker.js";
import { scheduleCapabilityRebuild } from "./capability-index.js";

export interface ToolExecContext {
  db: AppDatabase;
  chatId?: string;
  bridgePort?: number;
  llm?: LlmManager;
  queue?: AiQueueWorker;
  /** Optional embedder for immediate memory FTS/vector indexing on write. */
  embedder?: import("./embeddings/embedding-client.js").EmbeddingClient;
  activeAgentId?: string;
  /** Parent Kanban task card id (autonomous executor / workflow). */
  activeTaskCardId?: string;
  /** IN PROGRESS subtask card id linked to the current work step. */
  activeSubtaskCardId?: string;
  /** True when invoked from the autonomous-task-runner tick. */
  autonomousTick?: boolean;
  delegationDepth?: number;
  /**
   * Optional "contribute back" target. When a user chats with someone else's
   * shared agent and opted into contributing memory back to the owner, this is
   * the agent owner's (engine) DB. New durable memories created during the chat
   * are mirrored here in addition to `db` (the actor's work DB). Undefined for
   * owned agents and when contribute-back is off.
   */
  contributeDb?: AppDatabase;
  /** Set during reflection runs. */
  reflectionMode?: "approval" | "auto";
  reflectionWatermark?: string;
  /** Authenticated user id (marketplace remote inference metering). */
  userId?: string;
  /** Active workspace tenant (entitlement + metering scoping). */
  tenantId?: string;
  /** Session tool autonomy from composer (off | writes | full). */
  sessionAutonomy?: import("./agents/agents-db.js").CodeAutonomyLevel;
  /** Active tool call id for streaming terminal output. */
  activeToolCallId?: string;
  /** The agent backend's confirmation policy approved this exact tool call. */
  confirmationApproved?: boolean;
  onTerminalOutput?: (chunk: {
    stream: "stdout" | "stderr";
    text: string;
    toolCallId?: string;
  }) => void;
}

function pluginExecCtx(ctx: ToolExecContext): PluginToolExecContext {
  return {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    activeAgentId: ctx.activeAgentId,
    activeSubtaskCardId: ctx.activeSubtaskCardId,
    activeTaskCardId: ctx.activeTaskCardId,
  };
}

function kernelOperationContext(ctx: ToolExecContext): OperationContext {
  return {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    role:
      (ctx.activeAgentId ?? "intelligence") === "intelligence"
        ? "intelligence"
        : "editor",
    agentId: ctx.activeAgentId ?? "intelligence",
    source: "agent",
    requestId: ctx.activeToolCallId,
    idempotencyKey: ctx.activeToolCallId,
    trustedConfirmation: ctx.confirmationApproved === true,
    installedPluginIds: new Set(
      ctx.tenantId
        ? installedPluginIdsForTenant(getCoreDb(), ctx.tenantId)
        : []
    ),
  };
}

function toolMode(name: string): "auto" | "confirm" | null {
  const core = AI_TOOL_REGISTRY.find((t) => t.name === name);
  if (core) return core.mode;
  if (isKernelToolName(name)) {
    if (
      name.startsWith("create_") ||
      name.startsWith("update_") ||
      name.startsWith("delete_")
    ) {
      return "confirm";
    }
    const auto = objectTypeAutoToolDefs(
      new Set(AI_TOOL_REGISTRY.map((t) => t.name))
    ).find((t) => t.name === name);
    if (auto) return auto.mode;
    return "auto";
  }
  const plugin = pluginToolsAsAiDefs().find((t) => t.name === name);
  return plugin ? plugin.mode : null;
}

export interface NormalizedTodo {
  id?: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  /** Optional priority (1=high,2=med,3=low) for top-level tasks. */
  priority?: number;
  /** Optional child steps that become subtask cards linked to this task. */
  subtasks?: NormalizedTodo[];
  /** Opt parent into the autonomous executor (defaults true when subtasks exist). */
  auto?: boolean;
  /** Per-task tick budget for long-running autonomous work. */
  maxTaskTicks?: number;
}

/** Parent tasks with nested subtasks are autonomous Kanban runs — tag + init ticks. */
export function bootstrapAutonomousParentCard(
  db: AppDatabase,
  cardId: string,
  opts?: { maxTaskTicks?: number; force?: boolean }
): void {
  const row = db
    .prepare(`SELECT tags_json, context_json FROM ai_project_cards WHERE id = ?`)
    .get(cardId) as { tags_json: string | null; context_json: string | null } | undefined;
  if (!row) return;

  let tags: string[] = [];
  try {
    tags = row.tags_json ? (JSON.parse(row.tags_json) as string[]) : [];
  } catch {
    tags = [];
  }
  const hasAuto =
    tags.includes("auto") ||
    (row.tags_json != null && row.tags_json.includes("auto"));
  if (!hasAuto || opts?.force) {
    if (!tags.includes("auto")) tags.push("auto");
    db.prepare(
      `UPDATE ai_project_cards SET tags_json = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(JSON.stringify(tags), cardId);
  }

  let ctx: Record<string, unknown> = {};
  try {
    ctx = row.context_json ? JSON.parse(row.context_json) : {};
  } catch {
    ctx = {};
  }
  const auto = (ctx.__auto ?? {}) as Record<string, unknown>;
  const needsMeta =
    auto.maxTaskTicks == null ||
    auto.autoTicks == null ||
    auto.noProgressTicks == null;
  if (needsMeta || opts?.force) {
    const budget =
      opts?.maxTaskTicks != null && opts.maxTaskTicks > 0
        ? opts.maxTaskTicks
        : Number(auto.maxTaskTicks) > 0
          ? Number(auto.maxTaskTicks)
          : 200;
    ctx.__auto = {
      autoTicks: Number(auto.autoTicks ?? 0),
      doneSeen: Number(auto.doneSeen ?? 0),
      noProgressTicks: Number(auto.noProgressTicks ?? 0),
      maxTaskTicks: budget,
    };
    db.prepare(
      `UPDATE ai_project_cards SET context_json = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(JSON.stringify(ctx), cardId);
  }
}

/** Map a free-form status / column hint to a canonical todo status. */
function canonicalTodoStatus(raw: unknown, columnId: unknown): NormalizedTodo["status"] {
  const s = String(raw ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  if (["in_progress", "inprogress", "working", "active", "doing", "started"].includes(s))
    return "in_progress";
  if (["completed", "complete", "done", "accepted", "finished"].includes(s))
    return "completed";
  if (["cancelled", "canceled", "skipped", "dropped"].includes(s)) return "cancelled";
  if (["pending", "todo", "backlog", "not_started", "open", "queued"].includes(s))
    return "pending";
  // Fall back to a column hint (e.g. the model emits `columnId` instead of `status`).
  const col = String(columnId ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  if (col === "in_progress" || col === "review") return "in_progress";
  if (col === "done") return "completed";
  return "pending";
}

/**
 * Normalize a `todo_write` tool argument bag into canonical todo items.
 *
 * In grammar tool mode the per-tool `arguments` object is unconstrained
 * (`additionalProperties: true`), so local models routinely emit the list under
 * a non-canonical key (`tasks`/`items`/`list`) and the item text under
 * `text`/`title`/`task` with a `columnId` instead of `status`. Reading only
 * `args.todos[].content` silently dropped every item, so the Kanban cards never
 * got written and the in-chat checklist rendered empty. Accept the common
 * aliases so the tool is robust to model phrasing.
 */
export function normalizeTodoItems(args: Record<string, unknown>): NormalizedTodo[] {
  const rawList =
    (Array.isArray(args.todos) && args.todos) ||
    (Array.isArray(args.tasks) && args.tasks) ||
    (Array.isArray(args.items) && args.items) ||
    (Array.isArray(args.list) && args.list) ||
    [];
  const out: NormalizedTodo[] = [];
  for (const raw of rawList as unknown[]) {
    if (raw == null) continue;
    if (typeof raw === "string") {
      const content = raw.trim();
      if (content) out.push({ content, status: "pending" });
      continue;
    }
    if (typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const content = String(
      item.content ?? item.text ?? item.title ?? item.task ?? item.name ?? item.description ?? ""
    ).trim();
    if (!content) continue;
    const id =
      item.id != null && String(item.id).trim() ? String(item.id).trim() : undefined;
    // Nested subtasks under several common aliases. Recurse one level so a
    // parent Task carries its connected Subtasks instead of a flat list.
    const childRaw =
      (Array.isArray(item.subtasks) && item.subtasks) ||
      (Array.isArray(item.children) && item.children) ||
      (Array.isArray(item.steps) && item.steps) ||
      (Array.isArray(item.subTasks) && item.subTasks) ||
      null;
    const subtasks = childRaw
      ? normalizeTodoItems({ todos: childRaw })
      : undefined;
    const priority = Number.isFinite(Number(item.priority))
      ? Number(item.priority)
      : undefined;
    const maxTaskTicks = Number.isFinite(Number(item.maxTaskTicks))
      ? Number(item.maxTaskTicks)
      : undefined;
    const autoFlag =
      item.auto === true
        ? true
        : item.auto === false
          ? false
          : undefined;
    out.push({
      id,
      content,
      status: canonicalTodoStatus(item.status ?? item.state, item.columnId ?? item.column),
      ...(priority != null ? { priority } : {}),
      ...(maxTaskTicks != null ? { maxTaskTicks } : {}),
      ...(autoFlag != null ? { auto: autoFlag } : {}),
      ...(subtasks && subtasks.length ? { subtasks } : {}),
    });
  }
  return out;
}

function auditCtx(ctx: ToolExecContext) {
  return {
    agentId: ctx.activeAgentId ?? "intelligence",
    userId: ctx.userId ?? null,
  };
}

function codingTenantId(ctx: ToolExecContext): string | undefined {
  return ctx.tenantId ?? undefined;
}

function hookScope(ctx: ToolExecContext): HookOwnerScope {
  if (!ctx.userId) throw new Error("Authenticated user required");
  const agentIds = listAgents(ctx.db).map((a) => a.id);
  return { userId: ctx.userId, tenantId: ctx.tenantId ?? null, agentIds };
}

function wikiScope(ctx: ToolExecContext): WikiScope {
  if (!ctx.tenantId) return { tenantIds: [] };
  return { tenantIds: [ctx.tenantId] };
}

function isPlatformAdmin(userId?: string): boolean {
  if (!userId) return false;
  const row = getCoreDb()
    .prepare(`SELECT is_admin FROM users WHERE id = ?`)
    .get(userId) as { is_admin: number } | undefined;
  return row?.is_admin === 1;
}

const WEB_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/** Decode a small set of common HTML entities. */
function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'");
}

/** Strip HTML tags and decode entities; collapse whitespace. */
function stripHtml(input: string): string {
  return decodeHtmlEntities(input.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Resolve a DuckDuckGo redirect href to the real destination URL. */
function resolveDdgUrl(href: string): string {
  try {
    const m = /[?&]uddg=([^&]+)/.exec(href);
    if (m) return decodeURIComponent(m[1]);
  } catch {
    /* fall through to raw href */
  }
  if (href.startsWith("//")) return "https:" + href;
  return href;
}

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

function parseDdgResults(html: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  try {
    const anchorRe =
      /<a\b[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRe =
      /<a\b[^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippets: string[] = [];
    let sm: RegExpExecArray | null;
    while ((sm = snippetRe.exec(html)) !== null) {
      snippets.push(stripHtml(sm[1]));
    }
    let am: RegExpExecArray | null;
    let i = 0;
    while ((am = anchorRe.exec(html)) !== null) {
      const url = resolveDdgUrl(am[1]);
      const title = stripHtml(am[2]);
      results.push({ title, url, snippet: snippets[i] ?? "" });
      i++;
    }
  } catch {
    /* return whatever parsed so far */
  }
  return results;
}

async function bridgeFetch(
  ctx: ToolExecContext,
  apiPath: string,
  init?: RequestInit
): Promise<unknown> {
  const port = ctx.bridgePort ?? Number(process.env.BRIDGE_PORT ?? 3001);
  const res = await fetch(`http://127.0.0.1:${port}/api${apiPath}`, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${apiPath}: ${res.status} ${text}`);
  }
  return res.json();
}

/** POST/PUT/DELETE helper that serializes a JSON body. */
function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: body != null ? JSON.stringify(body) : undefined,
  };
}

/**
 * Loopback request init that forwards the caller's active tenant via
 * `X-Tenant-Id`. Per-tenant structure routes resolve their DB from this header,
 * so without it the loopback (an unauthenticated internal request) falls back to
 * the operator/global tenant — leaking structure mutations out of the requesting
 * user's workspace. Used for the Platform Builder structure tools, which write
 * to (and read from) the actor's own tenant DB (`ctx.db`).
 */
function tenantInit(
  ctx: ToolExecContext,
  method: string,
  body?: unknown
): RequestInit {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ctx.tenantId) headers["X-Tenant-Id"] = ctx.tenantId;
  return {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  };
}

/** Platform Builder scope helpers. */
function requireShareActor(ctx: ToolExecContext): {
  userId: string;
  tenantId: string;
} {
  if (!ctx.userId || !ctx.tenantId) {
    throw new Error("authenticated user and tenant required for share operations");
  }
  return { userId: ctx.userId, tenantId: ctx.tenantId };
}

function resolveGranteeUserId(
  core: ReturnType<typeof getCoreDb>,
  args: Record<string, unknown>
): string | undefined {
  if (args.granteeUserId != null && String(args.granteeUserId).trim()) {
    return String(args.granteeUserId).trim();
  }
  if (args.granteeEmail != null && String(args.granteeEmail).trim()) {
    const row = core
      .prepare("SELECT id FROM users WHERE email=?")
      .get(String(args.granteeEmail).trim().toLowerCase()) as { id: string } | undefined;
    if (!row) throw new Error("No user with that email");
    return row.id;
  }
  return undefined;
}

/** Parse an assignment scopeId ("dept", "dept/div", "dept/div/page") to a scope. */
function scopeFromAssignment(scopeId: string): PlatformScope {
  const [departmentId, divisionId, pageId] = String(scopeId).split("/");
  return {
    departmentId,
    divisionId: divisionId ?? null,
    pageId: pageId ?? null,
  };
}

type StructureNodeRow = {
  id: string;
  parent_id: string | null;
  segment: string;
};

/** Resolve Platform Builder scope for a structure_nodes row (walks ancestors). */
function scopeForStructureNode(
  db: AppDatabase,
  nodeId: string
): PlatformScope {
  const chain: StructureNodeRow[] = [];
  let currentId: string | null = nodeId;
  while (currentId) {
    const row = db
      .prepare(`SELECT id, parent_id, segment FROM structure_nodes WHERE id=?`)
      .get(currentId) as StructureNodeRow | undefined;
    if (!row) throw new Error(`structure node not found: ${currentId}`);
    chain.unshift(row);
    currentId = row.parent_id;
  }
  if (chain.length === 0) throw new Error(`structure node not found: ${nodeId}`);
  const dept = chain[0];
  const div = chain[1];
  const page = chain[2];
  return {
    departmentId: dept.id,
    divisionId: div?.segment ?? null,
    pageId: page?.segment ?? null,
  };
}

/**
 * Gate a Platform Builder mutation by role, run it, and append an audit row.
 * Denials and runtime errors are logged before rethrowing so the oversight feed
 * captures every attempt.
 */
async function runPlatform<T>(
  ctx: ToolExecContext,
  action: string,
  scope: PlatformScope | undefined,
  payload: unknown,
  run: () => Promise<T>
): Promise<T> {
  const agentId = ctx.activeAgentId ?? "intelligence";
  try {
    assertPlatformAction(ctx.db, { agentId, action, scope });
  } catch (err) {
    logPlatformAction(ctx.db, {
      agentId,
      action,
      scope,
      payload,
      result: `denied: ${(err as Error).message}`,
    });
    throw err;
  }
  try {
    const out = await run();
    logPlatformAction(ctx.db, { agentId, action, scope, payload, result: "ok" });
    return out;
  } catch (err) {
    logPlatformAction(ctx.db, {
      agentId,
      action,
      scope,
      payload,
      result: `error: ${(err as Error).message}`,
    });
    throw err;
  }
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolExecContext
): Promise<unknown> {
  if (isPluginToolName(name)) {
    const pluginResult = await executePluginTool(name, args, pluginExecCtx(ctx));
    if (pluginResult !== undefined) return pluginResult;
  }
  switch (name) {
    case "remember": {
      const text = String(args.text ?? "").trim();
      if (!text) throw new Error("text required");
      const id = uuidv4();
      const category = args.category ? String(args.category) : null;
      const agentId = ctx.activeAgentId ?? "intelligence";
      ctx.db
        .prepare(
          `INSERT INTO ai_memories (id, scope, chat_id, agent_id, text, category, source)
           VALUES (?, ?, ?, ?, ?, ?, 'model')`
        )
        .run(id, ctx.chatId ? "chat" : "global", ctx.chatId ?? null, agentId, text, category);
      indexMemory(ctx.db, ctx.embedder, id, text);
      // Contribute back to the agent owner's engine DB when enabled. The chat
      // itself lives in the actor's work DB, so the mirrored copy is stored as a
      // global (non-chat-scoped) memory the owner's agent can reuse.
      let contributed = false;
      if (ctx.contributeDb && ctx.contributeDb !== ctx.db) {
        const mirrorId = uuidv4();
        ctx.contributeDb
          .prepare(
            `INSERT INTO ai_memories (id, scope, chat_id, agent_id, text, category, source)
             VALUES (?, 'global', NULL, ?, ?, ?, 'model')`
          )
          .run(mirrorId, agentId, text, category);
        indexMemory(ctx.contributeDb, ctx.embedder, mirrorId, text);
        contributed = true;
      }
      return { ok: true, id, contributed };
    }
    case "use_skill": {
      // The model is inconsistent about the arg name; accept every alias it has
      // emitted (skillId/id/skill/name) so a correct call never dead-ends on a
      // naming mismatch.
      const agentId = ctx.activeAgentId ?? "intelligence";
      const skillId = String(
        args.skillId ?? args.id ?? args.skill ?? args.name ?? ""
      ).trim();
      const available = listAiSkills(ctx.db, false, agentId)
        .filter((s) => s.enabled && s.status !== "pending")
        .map((s) => s.id);
      if (!skillId) {
        return {
          error: "use_skill requires a skill id in the `skillId` argument.",
          availableSkills: available,
          example: { skillId: available[0] ?? "optimize-playbook" },
        };
      }
      const body = loadSkillBody(ctx.db, skillId, agentId);
      if (!body) {
        return {
          error: `Skill not found or disabled: "${skillId}".`,
          availableSkills: available,
          hint: "Call use_skill again with one of availableSkills as `skillId`.",
        };
      }
      return { id: skillId, body };
    }
    case "web_search": {
      const query = String(args.query ?? "").trim();
      if (!query) throw new Error("query required");
      const limit = Math.min(Math.max(Number(args.limit ?? 5) || 5, 1), 10);
      const endpoint = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      let results: WebSearchResult[] = [];
      try {
        const res = await fetch(endpoint, {
          headers: { "User-Agent": WEB_USER_AGENT },
        });
        const html = await res.text();
        results = parseDdgResults(html);
        if (results.length === 0) {
          const res2 = await fetch("https://html.duckduckgo.com/html/", {
            method: "POST",
            headers: {
              "User-Agent": WEB_USER_AGENT,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: `q=${encodeURIComponent(query)}`,
          });
          const html2 = await res2.text();
          results = parseDdgResults(html2);
        }
      } catch (err) {
        return {
          query,
          results: [],
          note: `DuckDuckGo request failed: ${(err as Error).message}`,
        };
      }
      if (results.length === 0) {
        return { query, results: [], note: "No results parsed from DuckDuckGo." };
      }
      return { query, results: results.slice(0, limit) };
    }
    case "fetch_url": {
      const url = String(args.url ?? "").trim();
      if (!url || !/^https?:\/\//i.test(url)) {
        throw new Error("Valid http(s) url required");
      }
      const maxChars = Math.min(
        Math.max(Number(args.maxChars ?? 6000) || 6000, 500),
        20000
      );
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": WEB_USER_AGENT },
          signal: controller.signal,
        });
        const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
        const raw = await res.text();
        const isHtml =
          contentType.includes("html") || (!contentType && /<html[\s>]/i.test(raw));
        if (!isHtml) {
          const text = raw.slice(0, maxChars);
          return { url, text, truncated: raw.length > maxChars };
        }
        const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw);
        const title = titleMatch ? stripHtml(titleMatch[1]) : "";
        const cleaned = raw
          .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
          .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
        const text = stripHtml(cleaned);
        return {
          url,
          title,
          text: text.slice(0, maxChars),
          truncated: text.length > maxChars,
        };
      } catch (err) {
        return { url, error: (err as Error).message };
      } finally {
        clearTimeout(timer);
      }
    }
    case "save_artifact": {
      const name = String(args.name ?? "").trim();
      if (!name) throw new Error("name required");
      const artifact = saveArtifact(ctx.db, ctx.activeAgentId ?? "intelligence", {
        name,
        content: String(args.content ?? ""),
        kind: args.kind ? String(args.kind) : undefined,
        mimeType: args.mimeType ? String(args.mimeType) : undefined,
        description: args.description ? String(args.description) : undefined,
      });
      return {
        ok: true,
        id: artifact.id,
        name: artifact.name,
        size_bytes: artifact.size_bytes,
      };
    }
    case "read_artifact": {
      const idOrName = String(args.id ?? args.name ?? "").trim();
      if (!idOrName) throw new Error("id or name required");
      const { artifact, content } = readArtifact(
        ctx.db,
        ctx.activeAgentId ?? "intelligence",
        idOrName
      );
      return { id: artifact.id, name: artifact.name, content };
    }
    case "list_artifacts": {
      const limit = args.limit != null ? Number(args.limit) : undefined;
      const rows = listArtifacts(ctx.db, ctx.activeAgentId ?? "intelligence", limit);
      return {
        artifacts: rows.map((a) => ({
          id: a.id,
          name: a.name,
          kind: a.kind,
          size_bytes: a.size_bytes,
          description: a.description,
          updated_at: a.updated_at,
        })),
      };
    }
    case "delete_artifact": {
      const id = String(args.id ?? args.name ?? "").trim();
      if (!id) throw new Error("id or name required");
      const ok = deleteArtifact(ctx.db, ctx.activeAgentId ?? "intelligence", id);
      return { ok };
    }
    case "create_project_card": {
      const projectId = String(args.projectId ?? "default");
      const columnId = String(args.columnId ?? "backlog");
      const title = String(args.title ?? "Untitled");
      const id = uuidv4();
      const maxOrder = ctx.db
        .prepare(
          `SELECT COALESCE(MAX(sort_order), -1) as m FROM ai_project_cards WHERE column_id = ?`
        )
        .get(columnId) as { m: number };
      // Priority (1=high,2=med,3=low) and tags are optional; tags accept an
      // array or comma string. Tagging a card "auto" opts it into the
      // autonomous executor's Task queue.
      const priority = Number.isFinite(Number(args.priority))
        ? Number(args.priority)
        : 2;
      const tagsJson =
        args.tags != null
          ? JSON.stringify(
              Array.isArray(args.tags)
                ? args.tags
                : String(args.tags)
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean)
            )
          : null;
      ctx.db
        .prepare(
          `INSERT INTO ai_project_cards (id, project_id, column_id, title, description, priority, tags_json, prompt, assigned_agent_id, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          projectId,
          columnId,
          title,
          args.description ? String(args.description) : null,
          priority,
          tagsJson,
          args.prompt ? String(args.prompt) : null,
          args.assignedAgentId ? String(args.assignedAgentId) : ctx.activeAgentId ?? null,
          maxOrder.m + 1
        );
      return { ok: true, id };
    }
    case "move_project_card": {
      const cardId = String(args.cardId ?? "");
      const columnId = String(args.columnId ?? "");
      ctx.db
        .prepare(
          `UPDATE ai_project_cards SET column_id = ?, updated_at = datetime('now') WHERE id = ?`
        )
        .run(columnId, cardId);
      return { ok: true };
    }
    case "list_project_cards": {
      const clauses: string[] = ["1=1"];
      const params: unknown[] = [];
      if (args.columnId != null) {
        clauses.push("column_id = ?");
        params.push(String(args.columnId));
      }
      if (args.priority != null) {
        clauses.push("priority = ?");
        params.push(Number(args.priority));
      }
      if (args.projectId != null) {
        clauses.push("project_id = ?");
        params.push(String(args.projectId));
      }
      if (args.assignedAgentId != null) {
        clauses.push("assigned_agent_id = ?");
        params.push(String(args.assignedAgentId));
      }
      // parentCardId === null/"null" → top-level only; a string → that parent;
      // undefined + !includeSubtasks → exclude subtasks (top-level only).
      if (args.parentCardId === null || args.parentCardId === "null") {
        clauses.push("parent_card_id IS NULL");
      } else if (args.parentCardId != null) {
        clauses.push("parent_card_id = ?");
        params.push(String(args.parentCardId));
      } else if (!args.includeSubtasks) {
        clauses.push("parent_card_id IS NULL");
      }
      const sort = String(args.sort ?? "priority");
      const orderBy =
        sort === "priority"
          ? "priority ASC, sort_order ASC"
          : "sort_order ASC";
      const limit = Number.isFinite(Number(args.limit)) && Number(args.limit) > 0
        ? Number(args.limit)
        : null;
      let sql = `SELECT * FROM ai_project_cards WHERE ${clauses.join(" AND ")} ORDER BY ${orderBy}`;
      if (limit != null) sql += ` LIMIT ${limit}`;
      const rows = ctx.db.prepare(sql).all(...params);
      return rows;
    }
    case "set_card_priority": {
      const cardId = String(args.cardId ?? "");
      const priority = Number(args.priority);
      if (!cardId || !Number.isFinite(priority)) {
        throw new Error("cardId and numeric priority required");
      }
      ctx.db
        .prepare(
          `UPDATE ai_project_cards SET priority = ?, updated_at = datetime('now') WHERE id = ?`
        )
        .run(priority, cardId);
      return { ok: true };
    }
    case "create_subtask": {
      const parentCardId = String(args.parentCardId ?? "");
      if (!parentCardId) throw new Error("parentCardId required");
      const parent = ctx.db
        .prepare(
          `SELECT project_id, column_id, priority FROM ai_project_cards WHERE id = ?`
        )
        .get(parentCardId) as
        | { project_id: string; column_id: string; priority: number }
        | undefined;
      if (!parent) throw new Error(`Parent card not found: ${parentCardId}`);
      const id = uuidv4();
      const columnId = args.columnId ? String(args.columnId) : "in_progress";
      const maxOrder = ctx.db
        .prepare(
          `SELECT COALESCE(MAX(sort_order), -1) as m FROM ai_project_cards WHERE column_id = ?`
        )
        .get(columnId) as { m: number };
      ctx.db
        .prepare(
          `INSERT INTO ai_project_cards
             (id, project_id, column_id, title, description, prompt, parent_card_id, priority, status, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          parent.project_id,
          columnId,
          String(args.title ?? "Subtask"),
          args.description ? String(args.description) : null,
          args.prompt ? String(args.prompt) : null,
          parentCardId,
          parent.priority ?? 2,
          "working",
          maxOrder.m + 1
        );
      return { ok: true, id };
    }
    case "list_subtasks": {
      const parentCardId = String(args.parentCardId ?? "");
      if (!parentCardId) throw new Error("parentCardId required");
      const rows = ctx.db
        .prepare(
          `SELECT id, title, column_id, status, priority, description, prompt
           FROM ai_project_cards WHERE parent_card_id = ? ORDER BY sort_order ASC`
        )
        .all(parentCardId) as Array<{ column_id: string; status: string | null }>;
      const total = rows.length;
      const done = rows.filter(
        (r) => r.column_id === "done" || r.status === "accepted"
      ).length;
      return { subtasks: rows, total, done, open: total - done };
    }
    case "comment_card":
    case "add_card_comment": {
      const cardId = String(
        args.cardId ??
          args.id ??
          args.card_id ??
          args.cardID ??
          args.subtaskId ??
          args.subtask_id ??
          args.card ??
          ""
      );
      const body = String(
        args.body ??
          args.comment ??
          args.note ??
          args.text ??
          args.message ??
          args.content ??
          ""
      ).trim();
      if (!cardId) throw new Error("cardId required (the card/subtask id to comment on)");
      if (!body)
        throw new Error(
          "body required — pass the note text in `body` (a non-empty sentence describing what you did/the result). A card id with only a `kind` is not enough."
        );
      const author = args.author === "user" ? "user" : "agent";
      // Audit-log category for the entry (note | action | result | issue).
      const kind =
        args.kind != null && String(args.kind).trim()
          ? String(args.kind).trim()
          : null;
      const id = uuidv4();
      ctx.db
        .prepare(
          `INSERT INTO ai_card_comments (id, card_id, author, body, kind) VALUES (?, ?, ?, ?, ?)`
        )
        .run(id, cardId, author, body, kind);
      if (author === "agent" && kind === "result") {
        advanceSubtaskOnResultComment(ctx.db, cardId, ctx.tenantId);
      } else if (author === "agent") {
        const row = ctx.db
          .prepare(`SELECT parent_card_id FROM ai_project_cards WHERE id = ?`)
          .get(cardId) as { parent_card_id: string | null } | undefined;
        if (row?.parent_card_id) {
          reconcileParentProgress(ctx.db, row.parent_card_id, ctx.tenantId);
        }
      }
      broadcastCardActivity(ctx.tenantId, {
        cardId,
        agentId: ctx.activeAgentId ?? null,
        chatId: ctx.chatId ?? null,
        reason: "comment",
      });
      return { ok: true, id };
    }
    case "list_card_comments": {
      const cardId = String(args.cardId ?? "");
      if (!cardId) throw new Error("cardId required");
      const rows = ctx.db
        .prepare(
          `SELECT id, card_id, author, body, kind, created_at FROM ai_card_comments
           WHERE card_id = ? ORDER BY created_at ASC`
        )
        .all(cardId);
      return { comments: rows };
    }
    case "list_user_calendar": {
      const userId = ctx.userId;
      if (!userId) throw new Error("Authenticated user required");
      const db = getUserOwnerTenantDb(userId);
      const clauses = ["user_id = ?"];
      const params: unknown[] = [userId];
      if (args.from != null) {
        clauses.push("start_at >= ?");
        params.push(String(args.from));
      }
      if (args.to != null) {
        clauses.push("start_at <= ?");
        params.push(String(args.to));
      }
      const limit = Number.isFinite(Number(args.limit)) && Number(args.limit) > 0
        ? Number(args.limit)
        : 100;
      const rows = db
        .prepare(
          `SELECT * FROM ai_calendar_events WHERE ${clauses.join(" AND ")}
           ORDER BY start_at ASC LIMIT ${limit}`
        )
        .all(...params);
      return rows;
    }
    case "create_user_calendar_event": {
      const userId = ctx.userId;
      if (!userId) throw new Error("Authenticated user required");
      const title = String(args.title ?? "").trim();
      const startAt = String(args.start_at ?? "").trim();
      if (!title || !startAt) throw new Error("title and start_at required");
      const db = getUserOwnerTenantDb(userId);
      const id = uuidv4();
      const kind = ["event", "task", "appointment"].includes(String(args.kind))
        ? String(args.kind)
        : "event";
      db.prepare(
        `INSERT INTO ai_calendar_events
           (id, agent_id, user_id, kind, title, description, start_at, end_at, all_day, location, status)
         VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')`
      ).run(
        id,
        userId,
        kind,
        title,
        args.description ? String(args.description) : null,
        startAt,
        args.end_at ? String(args.end_at) : null,
        args.all_day ? 1 : 0,
        args.location ? String(args.location) : null
      );
      return { ok: true, id };
    }
    case "list_user_tasks": {
      const userId = ctx.userId;
      if (!userId) throw new Error("Authenticated user required");
      const db = getUserOwnerTenantDb(userId);
      const pid = ensureUserProject(userId, db);
      const clauses = ["project_id = ?"];
      const params: unknown[] = [pid];
      if (args.columnId != null) {
        clauses.push("column_id = ?");
        params.push(String(args.columnId));
      }
      if (!args.includeSubtasks) {
        clauses.push("parent_card_id IS NULL");
      }
      const limit = Number.isFinite(Number(args.limit)) && Number(args.limit) > 0
        ? Number(args.limit)
        : 50;
      const rows = db
        .prepare(
          `SELECT * FROM ai_project_cards WHERE ${clauses.join(" AND ")}
           ORDER BY priority ASC, sort_order ASC LIMIT ${limit}`
        )
        .all(...params);
      return rows;
    }
    case "create_user_task": {
      const userId = ctx.userId;
      if (!userId) throw new Error("Authenticated user required");
      const title = String(args.title ?? "").trim();
      if (!title) throw new Error("title required");
      const db = getUserOwnerTenantDb(userId);
      const pid = ensureUserProject(userId, db);
      const columnId = args.columnId ? String(args.columnId) : "backlog";
      const maxOrder = db
        .prepare(
          `SELECT COALESCE(MAX(sort_order), -1) as m FROM ai_project_cards WHERE column_id = ? AND project_id = ?`
        )
        .get(columnId, pid) as { m: number };
      const id = uuidv4();
      db.prepare(
        `INSERT INTO ai_project_cards (id, project_id, column_id, title, description, due_at, priority, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        pid,
        columnId,
        title,
        args.description ? String(args.description) : null,
        args.dueAt ? String(args.dueAt) : null,
        args.priority != null ? Number(args.priority) : 2,
        maxOrder.m + 1
      );
      return { ok: true, id };
    }
    case "update_card": {
      const cardId = String(args.cardId ?? "");
      if (!cardId) throw new Error("cardId required");
      const sets: string[] = [];
      const params: unknown[] = [];
      if (args.columnId != null) {
        sets.push("column_id = ?");
        params.push(String(args.columnId));
      }
      if (args.status != null) {
        sets.push("status = ?");
        params.push(String(args.status));
      }
      if (args.title != null) {
        sets.push("title = ?");
        params.push(String(args.title));
      }
      if (args.description != null) {
        sets.push("description = ?");
        params.push(String(args.description));
      }
      if (args.priority != null) {
        sets.push("priority = ?");
        params.push(Number(args.priority));
      }
      if (args.assignedAgentId != null) {
        sets.push("assigned_agent_id = ?");
        params.push(String(args.assignedAgentId));
      }
      if (!sets.length) return { ok: true, unchanged: true };
      sets.push("updated_at = datetime('now')");
      params.push(cardId);
      ctx.db
        .prepare(`UPDATE ai_project_cards SET ${sets.join(", ")} WHERE id = ?`)
        .run(...params);
      return { ok: true };
    }
    case "create_skill": {
      const name = String(args.name ?? "").trim();
      const description = String(args.description ?? "").trim();
      const body = String(args.body ?? "").trim();
      if (!name || !body) throw new Error("name and body required");
      const gate = gateSkillDraft(ctx.db, ctx.activeAgentId ?? "intelligence", {
        name,
        body,
      });
      if (gate) throw new Error(`Skill rejected: ${gate}`);
      const id = createSkillFile(
        ctx.db,
        ctx.activeAgentId ?? "intelligence",
        {
          name,
          description,
          body,
          tools: Array.isArray(args.tools) ? args.tools.map(String) : undefined,
          departments: Array.isArray(args.departments)
            ? args.departments.map(String)
            : undefined,
        },
        "pending"
      );
      scheduleCapabilityRebuild(ctx.db, ctx.activeAgentId ?? "intelligence");
      return { ok: true, id, status: "pending" };
    }
    case "create_rule": {
      const name = String(args.name ?? "").trim();
      const description = String(args.description ?? "").trim();
      const body = String(args.body ?? "").trim();
      if (!name || !body) throw new Error("name and body required");
      const id = createRuleFile(
        ctx.db,
        ctx.activeAgentId ?? "intelligence",
        {
          name,
          description,
          body,
          globs: Array.isArray(args.globs) ? args.globs.map(String) : undefined,
          departments: Array.isArray(args.departments)
            ? args.departments.map(String)
            : undefined,
          alwaysApply: typeof args.alwaysApply === "boolean" ? args.alwaysApply : undefined,
          priority: args.priority != null ? Number(args.priority) : undefined,
        },
        "pending"
      );
      return { ok: true, id, status: "pending" };
    }
    case "list_subagents": {
      return listAgents(ctx.db).map((a) => ({
        id: a.id,
        name: a.name,
        backend: a.backend,
        description: a.description,
        enabled: a.enabled,
      }));
    }
    case "delegate_to_subagent": {
      if (!ctx.llm) throw new Error("Subagent delegation requires LLM context");
      const agentRef = String(args.agent ?? "");
      const prompt = String(args.prompt ?? "");
      const context = args.context ? String(args.context) : "";
      if (!agentRef || !prompt) throw new Error("agent and prompt required");
      let agentId = agentRef;
      const byName = ctx.db
        .prepare(`SELECT id FROM ai_agents WHERE lower(name) = lower(?) LIMIT 1`)
        .get(agentRef) as { id: string } | undefined;
      if (byName) agentId = byName.id;
      else if (!getAgent(ctx.db, agentRef)) {
        throw new Error(`Unknown subagent: ${agentRef}`);
      }
      const answer = await runSubagent({
        db: ctx.db,
        llm: ctx.llm,
        agentId,
        prompt,
        systemExtra: context || undefined,
        toolCtx: ctx,
        delegationDepth: ctx.delegationDepth ?? 0,
      });
      return { agentId, answer };
    }
    case "todo_write": {
      // Todos are the source of truth on the agent's Kanban board: each item is
      // persisted as a card so progress survives the chat. The chat still
      // renders a live checklist from this tool's args (the route turns it into
      // a 'todos' part). Re-running upserts by deterministic id so the same list
      // updates existing cards instead of duplicating.
      const todos = normalizeTodoItems(args);
      const agentId = ctx.activeAgentId ?? "intelligence";
      const projectId = ensureAgentProject(agentId, ctx.db);
      const scope = ctx.chatId ?? `agent-${agentId}`;
      const defaultMaxTaskTicks = Number.isFinite(Number(args.maxTaskTicks))
        ? Number(args.maxTaskTicks)
        : undefined;
      const lane = (status: string): { columnId: string; cardStatus: string } => {
        switch (status) {
          case "in_progress":
            return { columnId: "in_progress", cardStatus: "working" };
          case "completed":
            return { columnId: "done", cardStatus: "accepted" };
          case "cancelled":
            return { columnId: "done", cardStatus: "cancelled" };
          default:
            return { columnId: "backlog", cardStatus: "pending" };
        }
      };
      const upsert = ctx.db.prepare(
        `INSERT INTO ai_project_cards
           (id, project_id, column_id, title, status, priority, sort_order,
            linked_chat_id, assigned_agent_id, parent_card_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           column_id = excluded.column_id,
           title = excluded.title,
           status = excluded.status,
           priority = excluded.priority,
           sort_order = excluded.sort_order,
           parent_card_id = excluded.parent_card_id,
           updated_at = datetime('now')`
      );
      const cards: Array<{ id: string; status: string; parentId?: string }> = [];
      const keepIds: string[] = [];
      const keyOf = (todo: NormalizedTodo): string =>
        todo.id != null && String(todo.id).trim()
          ? String(todo.id).trim()
          : String(todo.content ?? "")
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .slice(0, 48);
      const writeCard = (
        todo: NormalizedTodo,
        index: number,
        parentCardId: string | null
      ): void => {
        const content = String(todo.content ?? "").trim();
        if (!content) return;
        const status = String(todo.status ?? "pending");
        const base = `todo_${scope}_${keyOf(todo)}`;
        const cardId = parentCardId ? `${parentCardId}__${keyOf(todo)}` : base;
        const { columnId, cardStatus } = lane(status);
        // Subtasks inherit the parent's priority; top-level todos default to med.
        const priority = Number.isFinite(Number(todo.priority))
          ? Number(todo.priority)
          : 2;
        upsert.run(
          cardId,
          projectId,
          columnId,
          content,
          cardStatus,
          priority,
          index,
          ctx.chatId ?? null,
          agentId,
          parentCardId
        );
        cards.push({ id: cardId, status, ...(parentCardId ? { parentId: parentCardId } : {}) });
        keepIds.push(cardId);
        const childTodos = todo.subtasks ?? [];
        childTodos.forEach((child, childIndex) => writeCard(child, childIndex, cardId));
        if (!parentCardId && childTodos.length > 0 && todo.auto !== false) {
          bootstrapAutonomousParentCard(ctx.db, cardId, {
            maxTaskTicks: todo.maxTaskTicks ?? defaultMaxTaskTicks,
          });
        }
      };
      todos.forEach((todo, index) => writeCard(todo, index, null));
      // Full-list semantics: when not merging, retire previously-tracked todo
      // cards for this scope that dropped out of the latest list.
      if (args.merge !== true) {
        const placeholders = keepIds.map(() => "?").join(",");
        const notIn = keepIds.length ? ` AND id NOT IN (${placeholders})` : "";
        ctx.db
          .prepare(
            `UPDATE ai_project_cards
             SET column_id = 'done', status = 'cancelled', updated_at = datetime('now')
             WHERE project_id = ? AND id LIKE ? AND status != 'cancelled'${notIn}`
          )
          .run(projectId, `todo_${scope}_%`, ...keepIds);
      }
      broadcastCardActivity(ctx.tenantId, {
        agentId,
        chatId: ctx.chatId ?? null,
        reason: "todo_write",
      });
      return { ok: true, projectId, count: cards.length, cards };
    }
    case "ask_cursor_agent": {
      const prompt = String(args.prompt ?? "").trim();
      if (!prompt) throw new Error("prompt required");
      const mode =
        args.mode === "plan" || args.mode === "ask" ? args.mode : undefined;
      const bundled = buildContractorContextBundle(ctx.db, prompt);
      const res = await runCursorAgent({
        prompt: bundled,
        model: args.model ? String(args.model) : "auto",
        mode,
        worktree: args.worktree === false ? false : true,
        workspace: args.workspace ? String(args.workspace) : config.repoRoot,
        force: args.force === true,
      });
      return {
        answer: res.text,
        sessionId: res.sessionId,
        isError: res.isError,
        contractorContextIncluded: true,
      };
    }
    /* -------------------- Platform Builder: Structure (Phase A) ---------- */
    case "list_structure":
      return executeKernelTool(
        ctx.db,
        "list_records",
        { objectType: "StructureNode" },
        kernelOperationContext(ctx)
      );
    case "create_department": {
      const kind =
        args.kind != null ? String(args.kind) : undefined;
      if (kind && !isRegisteredPageKind(kind)) throw new Error(`invalid kind: ${kind}`);
      const body = {
        id: String(args.id ?? ""),
        parentId: null,
        label: String(args.label ?? ""),
        icon: String(args.icon ?? ""),
        kind,
      };
      return runPlatform(ctx, "create_department", undefined, body, () =>
        Promise.resolve(
          executeKernelTool(
            ctx.db,
            "create_record",
            {
              objectType: "StructureNode",
              data: {
                id: body.id,
                parent_id: null,
                label: body.label,
                icon: body.icon,
                kind: body.kind,
              },
            },
            kernelOperationContext(ctx)
          )
        )
      );
    }
    case "create_division": {
      const departmentId = String(args.departmentId ?? "");
      const kind =
        args.kind != null ? String(args.kind) : undefined;
      if (kind && !isRegisteredPageKind(kind)) throw new Error(`invalid kind: ${kind}`);
      const body = {
        id: String(args.id ?? ""),
        parentId: departmentId,
        label: String(args.label ?? ""),
        icon: String(args.icon ?? ""),
        rightSidebar: args.rightSidebar != null ? String(args.rightSidebar) : undefined,
        kind,
        segment: args.segment != null ? String(args.segment) : undefined,
      };
      return runPlatform(ctx, "create_division", { departmentId }, body, () =>
        Promise.resolve(
          executeKernelTool(
            ctx.db,
            "create_record",
            {
              objectType: "StructureNode",
              data: {
                id: body.id,
                parent_id: body.parentId,
                label: body.label,
                icon: body.icon,
                right_sidebar: body.rightSidebar,
                kind: body.kind,
                segment: body.segment,
              },
            },
            kernelOperationContext(ctx)
          )
        )
      );
    }
    case "create_page": {
      const departmentId = String(args.departmentId ?? "");
      const divisionId = String(args.divisionId ?? "");
      const kind =
        args.kind != null ? String(args.kind) : undefined;
      if (kind && !isRegisteredPageKind(kind)) throw new Error(`invalid kind: ${kind}`);
      const body = {
        id: String(args.id ?? ""),
        parentId: `${departmentId}-${divisionId}`,
        label: String(args.label ?? ""),
        icon: String(args.icon ?? ""),
        segment: String(args.segment ?? ""),
        kind,
      };
      return runPlatform(
        ctx,
        "create_page",
        { departmentId, divisionId },
        body,
        () =>
          Promise.resolve(
            executeKernelTool(
              ctx.db,
              "create_record",
              {
                objectType: "StructureNode",
                data: {
                  id: body.id,
                  parent_id: body.parentId,
                  label: body.label,
                  icon: body.icon,
                  segment: body.segment,
                  kind: body.kind,
                },
              },
              kernelOperationContext(ctx)
            )
          )
      );
    }
    case "update_structure_node": {
      const nodeType = String(args.nodeType ?? "");
      const departmentId = String(args.departmentId ?? "");
      const divisionId = args.divisionId != null ? String(args.divisionId) : undefined;
      const pageId = args.pageId != null ? String(args.pageId) : undefined;
      const patch: Record<string, unknown> = {};
      if (args.label != null) patch.label = String(args.label);
      if (args.icon != null) patch.icon = String(args.icon);
      if (args.segment != null) patch.segment = String(args.segment);
      if (args.rightSidebar != null) patch.rightSidebar = String(args.rightSidebar);
      if (args.kind != null) {
        const kind = String(args.kind);
        if (!isRegisteredPageKind(kind)) throw new Error(`invalid kind: ${kind}`);
        patch.kind = kind;
      }
      let scope: PlatformScope;
      let nodeId: string;
      if (nodeType === "department") {
        scope = { departmentId };
        nodeId = departmentId;
      } else if (nodeType === "division") {
        if (!divisionId) throw new Error("divisionId required for division");
        scope = { departmentId, divisionId };
        nodeId = `${departmentId}-${divisionId}`;
      } else if (nodeType === "page") {
        if (!divisionId || !pageId) throw new Error("divisionId and pageId required for page");
        scope = { departmentId, divisionId, pageId };
        nodeId = `${departmentId}-${divisionId}-${pageId}`;
      } else {
        throw new Error(`invalid nodeType: ${nodeType}`);
      }
      return runPlatform(ctx, "update_structure_node", scope, { nodeType, patch }, () =>
        Promise.resolve(
          executeKernelTool(
            ctx.db,
            "update_record",
            {
              objectType: "StructureNode",
              id: nodeId,
              data: {
                label: patch.label,
                icon: patch.icon,
                segment: patch.segment,
                kind: patch.kind,
                right_sidebar: patch.rightSidebar,
              },
            },
            kernelOperationContext(ctx)
          )
        )
      );
    }
    case "delete_structure_node": {
      const nodeType = String(args.nodeType ?? "");
      const departmentId = String(args.departmentId ?? "");
      const divisionId = args.divisionId != null ? String(args.divisionId) : undefined;
      const pageId = args.pageId != null ? String(args.pageId) : undefined;
      let scope: PlatformScope;
      let nodeId: string;
      if (nodeType === "department") {
        scope = { departmentId };
        nodeId = departmentId;
      } else if (nodeType === "division") {
        if (!divisionId) throw new Error("divisionId required for division");
        scope = { departmentId, divisionId };
        nodeId = `${departmentId}-${divisionId}`;
      } else if (nodeType === "page") {
        if (!divisionId || !pageId) throw new Error("divisionId and pageId required for page");
        scope = { departmentId, divisionId, pageId };
        nodeId = `${departmentId}-${divisionId}-${pageId}`;
      } else {
        throw new Error(`invalid nodeType: ${nodeType}`);
      }
      return runPlatform(ctx, "delete_structure_node", scope, { nodeType }, () =>
        Promise.resolve(
          executeKernelTool(
            ctx.db,
            "delete_record",
            { objectType: "StructureNode", id: nodeId },
            kernelOperationContext(ctx)
          )
        )
      );
    }
    case "assign_agent": {
      const scopeType = String(args.scopeType ?? "");
      const scopeId = String(args.scopeId ?? "");
      const body = {
        scopeType,
        scopeId,
        agentId: String(args.agentId ?? ""),
        role: args.role != null ? String(args.role) : undefined,
      };
      return runPlatform(
        ctx,
        "assign_agent",
        scopeFromAssignment(scopeId),
        body,
        () => bridgeFetch(ctx, "/ai/agents/assignments", tenantInit(ctx, "PUT", body))
      );
    }
    case "set_agent_role": {
      const scopeType = String(args.scopeType ?? "") as
        | "department"
        | "division"
        | "page";
      const scopeId = String(args.scopeId ?? "");
      const role = args.role != null ? String(args.role) : "";
      return runPlatform(
        ctx,
        "set_agent_role",
        scopeFromAssignment(scopeId),
        { scopeType, scopeId, role },
        () => {
          const existing = getAssignment(ctx.db, scopeType, scopeId);
          if (!existing) throw new Error(`no agent assigned to ${scopeType} ${scopeId}`);
          const body = { scopeType, scopeId, agentId: existing.agent_id, role };
          return bridgeFetch(ctx, "/ai/agents/assignments", tenantInit(ctx, "PUT", body));
        }
      );
    }
    case "create_agent": {
      const name = String(args.name ?? "").trim();
      if (!name) throw new Error("name required");
      const body = {
        id: args.id != null ? String(args.id) : undefined,
        name,
        description: args.description != null ? String(args.description) : undefined,
        icon: args.icon != null ? String(args.icon) : undefined,
        parentId:
          args.parentId != null && args.parentId !== ""
            ? String(args.parentId)
            : "intelligence",
        systemPrompt: args.systemPrompt != null ? String(args.systemPrompt) : undefined,
        cloneFromId: args.cloneFromId != null ? String(args.cloneFromId) : undefined,
        modelPath: args.modelPath != null ? String(args.modelPath) : undefined,
      };
      return runPlatform(ctx, "create_agent", undefined, body, () => {
        const agent = createAgent(ctx.db, body);
        return Promise.resolve(agent);
      });
    }
    case "attach_node_agent": {
      const nodeId = String(args.nodeId ?? "").trim();
      if (!nodeId) throw new Error("nodeId required");
      const agentId =
        args.agentId === null || args.agentId === undefined || args.agentId === ""
          ? null
          : String(args.agentId);
      const scope = scopeForStructureNode(ctx.db, nodeId);
      return runPlatform(
        ctx,
        "attach_node_agent",
        scope,
        { nodeId, agentId },
        () =>
          Promise.resolve(
            executeKernelTool(
              ctx.db,
              "run_record_action",
              {
                objectType: "StructureNode",
                id: nodeId,
                action: "set_agent",
                input: { agent_id: agentId },
              },
              kernelOperationContext(ctx)
            )
          )
      );
    }

    /* -------------------- Shares & collaboration ------------------------- */
    case "list_share_grants": {
      const { userId } = requireShareActor(ctx);
      const core = getCoreDb();
      return {
        grants: listShareGrantsForUser(core, userId),
        sharedTree: buildSharedSidebarTree(core, userId),
      };
    }
    case "create_share_grant": {
      const { userId, tenantId } = requireShareActor(ctx);
      const core = getCoreDb();
      const resourceKind = String(args.resourceKind ?? "") as MarketplaceListingKind;
      const resourceId = String(args.resourceId ?? "");
      if (!resourceKind || !resourceId) {
        throw new Error("resourceKind and resourceId required");
      }
      const granteeUserId = resolveGranteeUserId(core, args);
      const granteeTenantId =
        args.granteeTenantId != null ? String(args.granteeTenantId) : undefined;
      if (!granteeUserId && !granteeTenantId) {
        throw new Error("granteeUserId, granteeEmail, or granteeTenantId required");
      }
      const isScResource = resourceKind === "department" || resourceKind === "division";
      try {
        const id = createShareGrant(core, {
          ownerTenantId: tenantId,
          ownerUserId: userId,
          resourceKind,
          resourceId,
          granteeUserId,
          granteeTenantId,
          role: (args.role as ShareGrantRole | undefined) ?? "viewer",
          bridgeUrl: isScResource ? config.federation.publicUrl : null,
          federationToken: isScResource ? uuidv4() : null,
        });
        return { id };
      } catch (err) {
        if (err instanceof ShareError) throw new Error(err.message);
        throw err;
      }
    }
    case "share_model": {
      const { userId, tenantId } = requireShareActor(ctx);
      const core = getCoreDb();
      const modelPath = String(args.modelPath ?? "").trim();
      if (!modelPath) throw new Error("modelPath required");
      const granteeUserId = resolveGranteeUserId(core, args);
      if (!granteeUserId) throw new Error("granteeUserId or granteeEmail required");
      if (granteeUserId === userId) throw new Error("Cannot share a model with yourself");
      const existing = findActiveEndpointByModelPath(core, userId, modelPath);
      const derivedName =
        (args.name != null && String(args.name).trim()) ||
        modelPath.split(/[\\/]/).pop()!.replace(/\.gguf$/i, "");
      const endpointId =
        (existing?.id as string | undefined) ??
        createInferenceEndpoint(core, {
          ownerTenantId: tenantId,
          ownerUserId: userId,
          name: derivedName,
          baseModelPath: modelPath,
        });
      const grantId = createShareGrant(core, {
        ownerTenantId: tenantId,
        ownerUserId: userId,
        resourceKind: "model",
        resourceId: endpointId,
        granteeUserId,
        role: "viewer",
        bridgeUrl: null,
        federationToken: null,
      });
      return { id: grantId, endpointId };
    }
    case "revoke_share_grant": {
      const { userId } = requireShareActor(ctx);
      const grantId = String(args.grantId ?? "");
      if (!grantId) throw new Error("grantId required");
      try {
        revokeShareGrant(getCoreDb(), grantId, userId);
        return { ok: true };
      } catch (err) {
        if (err instanceof ShareError) throw new Error(err.message);
        throw err;
      }
    }

    /* -------------------- Automations / workflows ------------------------ */
    case "list_workflows": {
      const agentId = String(args.agentId ?? ctx.activeAgentId ?? "intelligence");
      const rows = ctx.db
        .prepare(
          `SELECT id, name, config_json, enabled, agent_id, created_at, updated_at
           FROM ai_workflows WHERE agent_id = ? ORDER BY updated_at DESC`
        )
        .all(agentId);
      return { agentId, workflows: rows };
    }
    case "run_workflow": {
      const workflowId = String(args.workflowId ?? "").trim();
      if (!workflowId) throw new Error("workflowId required");
      if (!ctx.queue) throw new Error("run_workflow: queue worker unavailable");
      let prompt: string | undefined;
      if (typeof args.input === "string") {
        prompt = args.input;
      } else if (args.input != null) {
        prompt = JSON.stringify(args.input);
      }
      const jobId = ctx.queue.enqueue({
        workflowId,
        prompt,
        tenantId: ctx.tenantId,
        context: {
          agentId: ctx.activeAgentId ?? "intelligence",
          source: "run_workflow_tool",
          chatId: ctx.chatId ?? null,
        },
        priority: 2,
      });
      return { jobId, workflowId, status: "enqueued" };
    }
    case "create_workflow": {
      const name = String(args.name ?? "").trim();
      if (!name) throw new Error("name required");
      const agentId = String(args.agentId ?? ctx.activeAgentId ?? "intelligence");
      const wf = createWorkflow(ctx.db, {
        name,
        config: (args.config as WorkflowGraph | undefined) ?? undefined,
        enabled: args.enabled === false ? false : true,
      });
      ctx.db
        .prepare(`UPDATE ai_workflows SET agent_id = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(agentId, wf.id);
      reloadAiSchedules();
      scheduleCapabilityRebuild(ctx.db, agentId);
      return { ...wf, agentId };
    }
    case "update_workflow": {
      const id = String(args.id ?? "");
      if (!id) throw new Error("id required");
      const wf = updateWorkflow(ctx.db, id, {
        name: args.name != null ? String(args.name) : undefined,
        config: args.config as WorkflowGraph | undefined,
        enabled: args.enabled != null ? Boolean(args.enabled) : undefined,
      });
      if (!wf) throw new Error(`workflow not found: ${id}`);
      reloadAiSchedules();
      scheduleCapabilityRebuild(ctx.db, ctx.activeAgentId ?? "intelligence");
      return wf;
    }
    case "list_schedules":
      return { schedules: listSchedules(ctx.db) };
    case "create_schedule": {
      const workflowId = String(args.workflowId ?? "");
      const cronExpr = String(args.cronExpr ?? "");
      if (!workflowId || !cronExpr) throw new Error("workflowId and cronExpr required");
      const sched = createSchedule(ctx.db, {
        workflowId,
        cronExpr,
        timezone: args.timezone != null ? String(args.timezone) : undefined,
        enabled: args.enabled === false ? false : true,
      });
      reloadAiSchedules();
      return sched;
    }

    case "read_file":
      return fsReadFile({
        path: String(args.path ?? ""),
        offset: args.offset != null ? Number(args.offset) : undefined,
        limit: args.limit != null ? Number(args.limit) : undefined,
        tenantId: codingTenantId(ctx),
      });

    case "list_dir":
      return fsListDir({
        path: args.path ? String(args.path) : undefined,
        recursive: args.recursive === true,
        tenantId: codingTenantId(ctx),
      });

    case "glob":
      return globFiles({
        pattern: String(args.pattern ?? ""),
        cwd: args.cwd ? String(args.cwd) : undefined,
        tenantId: codingTenantId(ctx),
      });

    case "grep":
      return grepSearch({
        pattern: String(args.pattern ?? ""),
        path: args.path ? String(args.path) : undefined,
        glob: args.glob ? String(args.glob) : undefined,
        caseInsensitive: args.caseInsensitive === true,
        tenantId: codingTenantId(ctx),
      });

    case "write_file": {
      const filePath = String(args.path ?? "");
      const content = String(args.content ?? "");
      const prior = readFileRaw({ path: filePath, tenantId: codingTenantId(ctx) });
      const res = fsWriteFile({
        path: filePath,
        content,
        tenantId: codingTenantId(ctx),
      });
      const diff = computeUnifiedDiff(prior, content, res.path);
      logToolAudit(ctx.db, {
        ...auditCtx(ctx),
        action: "write_file",
        path: res.path,
        bytesOut: res.bytes,
        result: res.created ? "created" : "updated",
      });
      return { ...res, diff };
    }

    case "edit_file": {
      const filePath = String(args.path ?? "");
      const oldStr = String(args.old_string ?? "");
      const newStr = String(args.new_string ?? "");
      const before = readFileRaw({ path: filePath, tenantId: codingTenantId(ctx) });
      const res = fsEditFile({
        path: filePath,
        old_string: oldStr,
        new_string: newStr,
        tenantId: codingTenantId(ctx),
      });
      const after = readFileRaw({ path: filePath, tenantId: codingTenantId(ctx) });
      const diff = computeUnifiedDiff(before, after, res.path);
      logToolAudit(ctx.db, {
        ...auditCtx(ctx),
        action: "edit_file",
        path: res.path,
        bytesOut: res.bytes,
        result: "ok",
      });
      return { ...res, diff };
    }

    case "delete_file": {
      const res = fsDeleteFile({ path: String(args.path ?? ""), tenantId: codingTenantId(ctx) });
      logToolAudit(ctx.db, {
        ...auditCtx(ctx),
        action: "delete_file",
        path: res.path,
        result: res.deleted ? "deleted" : "missing",
      });
      return res;
    }

    case "run_terminal": {
      const res = await runTerminal({
        command: String(args.command ?? ""),
        cwd: args.cwd ? String(args.cwd) : undefined,
        timeoutMs: args.timeoutMs != null ? Number(args.timeoutMs) : undefined,
        tenantId: codingTenantId(ctx),
        onOutput: (chunk) => {
          ctx.onTerminalOutput?.({
            ...chunk,
            toolCallId: ctx.activeToolCallId,
          });
        },
      });
      const bytesOut =
        Buffer.byteLength(res.stdout, "utf8") + Buffer.byteLength(res.stderr, "utf8");
      logToolAudit(ctx.db, {
        ...auditCtx(ctx),
        action: "run_terminal",
        cwd: res.cwd,
        command: res.command,
        exitCode: res.exitCode,
        bytesOut,
        result: res.timedOut ? "timeout" : res.exitCode === 0 ? "ok" : "error",
      });
      return res;
    }

    case "codebase_search":
      return codebaseSearch({
        query: String(args.query ?? ""),
        path: args.path ? String(args.path) : undefined,
        glob: args.glob ? String(args.glob) : undefined,
        limit: args.limit != null ? Number(args.limit) : undefined,
        tenantId: codingTenantId(ctx),
      });

    case "apply_patch": {
      const res = applyPatch({
        path: String(args.path ?? ""),
        patch: String(args.patch ?? ""),
        tenantId: codingTenantId(ctx),
      });
      logToolAudit(ctx.db, {
        ...auditCtx(ctx),
        action: "apply_patch",
        path: res.path,
        bytesOut: res.bytes,
        result: "ok",
      });
      return res;
    }

    case "read_diagnostics":
      return readDiagnostics({
        cwd: args.cwd ? String(args.cwd) : undefined,
        tenantId: codingTenantId(ctx),
      });

    case "revert_file": {
      const res = await revertFile({
        path: String(args.path ?? ""),
        tenantId: codingTenantId(ctx),
      });
      logToolAudit(ctx.db, {
        ...auditCtx(ctx),
        action: "revert_file",
        path: String(args.path ?? ""),
        result: res.reverted ? "ok" : "error",
      });
      return res;
    }

    case "explore_codebase": {
      const queries = Array.isArray(args.queries)
        ? args.queries.map(String).filter(Boolean)
        : args.query
          ? [String(args.query)]
          : [];
      if (!queries.length) throw new Error("query or queries required");
      const capped = queries.slice(0, 4);
      const explorations = await Promise.all(
        capped.map(async (q) => {
          const search = await codebaseSearch({
            query: q,
            path: args.path ? String(args.path) : undefined,
            glob: args.glob ? String(args.glob) : undefined,
            tenantId: codingTenantId(ctx),
          });
          return { query: q, results: search.results };
        })
      );
      return { explorations, parallel: explorations.length };
    }

    case "list_notifications": {
      const limit = args.limit != null ? Number(args.limit) : undefined;
      const unreadOnly = args.unreadOnly === true;
      if (ctx.activeAgentId && ctx.activeAgentId !== "intelligence" && !ctx.userId) {
        return listNotificationsForAgent(ctx.activeAgentId, ctx.tenantId ?? null, {
          unreadOnly,
          limit,
        });
      }
      if (!ctx.userId) throw new Error("userId required");
      return listNotificationsForUser(ctx.userId, { unreadOnly, limit });
    }

    case "create_notification": {
      const title = String(args.title ?? "").trim();
      const body = args.body != null ? String(args.body).trim() : "";
      // The model sometimes calls this with `{}` before it has content. Reject
      // blank notifications so no empty row is persisted; the agent then retries
      // with a real title/body instead of leaving a useless notification.
      if (!title && !body) {
        throw new Error(
          "create_notification requires a non-empty title and/or body — provide real content and retry."
        );
      }
      const recipientKind = args.recipientKind === "agent" ? "agent" : "user";
      const recipientId =
        String(args.recipientId ?? "").trim() ||
        (recipientKind === "agent"
          ? ctx.activeAgentId ?? "intelligence"
          : ctx.userId ?? "");
      return createNotification({
        recipientKind,
        recipientId,
        recipientTenantId: ctx.tenantId ?? null,
        title: title || body.slice(0, 80),
        body: body || null,
        link: args.link ? String(args.link) : null,
        category: args.category ? String(args.category) : "system",
      });
    }

    case "mark_notification_read": {
      if (args.markAll === true) {
        if (!ctx.userId) throw new Error("userId required");
        const n = markAllRead({ kind: "user", id: ctx.userId });
        return { marked: n };
      }
      const ids = Array.isArray(args.ids) ? args.ids.map(String) : [];
      return { marked: markRead(ids) };
    }

    case "create_support_ticket": {
      const agentId = ctx.activeAgentId ?? "intelligence";
      const requesterKind = ctx.userId ? "user" : "agent";
      const requesterId = ctx.userId ?? agentId;
      return createTicket({
        requesterKind,
        requesterId,
        requesterTenantId: ctx.tenantId ?? null,
        subject: String(args.subject ?? ""),
        body: String(args.body ?? ""),
        category: args.category ? String(args.category) : null,
        priority: args.priority ? String(args.priority) : null,
      });
    }

    case "list_support_tickets": {
      if (args.admin === true) {
        if (!isPlatformAdmin(ctx.userId)) throw new Error("Platform admin required");
        return listAllTickets(
          args.status ? { status: String(args.status) as "open" | "in_progress" | "resolved" | "closed" } : {}
        );
      }
      const agentId = ctx.activeAgentId ?? "intelligence";
      const requesterKind = ctx.userId ? "user" : "agent";
      const requesterId = ctx.userId ?? agentId;
      return listTicketsForRequester(requesterKind, requesterId);
    }

    case "reply_support_ticket": {
      const ticketId = String(args.ticketId ?? "");
      const body = String(args.body ?? "");
      const agentId = ctx.activeAgentId ?? "intelligence";
      const author = isPlatformAdmin(ctx.userId)
        ? { kind: "admin" as const, id: ctx.userId! }
        : ctx.userId
          ? { kind: "user" as const, id: ctx.userId }
          : { kind: "agent" as const, id: agentId };
      return addSupportMessage(ticketId, author, body);
    }

    case "update_support_ticket": {
      if (!isPlatformAdmin(ctx.userId)) throw new Error("Platform admin required");
      return updateTicket(String(args.ticketId ?? ""), {
        status: args.status
          ? (String(args.status) as "open" | "in_progress" | "resolved" | "closed")
          : undefined,
      });
    }

    case "list_wiki_pages":
      return listWikiPages(wikiScope(ctx), {
        visibility: args.visibility === "external" ? "external" : args.visibility === "internal" ? "internal" : undefined,
        space: args.space ? String(args.space) : undefined,
        q: args.q ? String(args.q) : undefined,
      });

    case "read_wiki_page": {
      if (args.id) return getPageById(String(args.id));
      if (args.slug) return getPageBySlug(String(args.slug), wikiScope(ctx));
      throw new Error("id or slug required");
    }

    case "create_wiki_page": {
      if (!ctx.userId || !ctx.tenantId) throw new Error("user and tenant required");
      return createWikiPage({
        tenantId: ctx.tenantId,
        authorUserId: ctx.userId,
        title: String(args.title ?? ""),
        bodyMarkdown: args.bodyMarkdown ? String(args.bodyMarkdown) : "",
        visibility: args.visibility === "external" ? "external" : "internal",
        space: args.space ? String(args.space) : null,
        slug: args.slug ? String(args.slug) : undefined,
      });
    }

    case "update_wiki_page":
      return updateWikiPage(
        String(args.id ?? ""),
        {
          title: args.title !== undefined ? String(args.title) : undefined,
          bodyMarkdown: args.bodyMarkdown !== undefined ? String(args.bodyMarkdown) : undefined,
          visibility: args.visibility === "external" ? "external" : args.visibility === "internal" ? "internal" : undefined,
          space: args.space !== undefined ? (args.space ? String(args.space) : null) : undefined,
        },
        wikiScope(ctx)
      );

    case "delete_wiki_page":
      deleteWikiPage(String(args.id ?? ""), wikiScope(ctx));
      return { ok: true };

    case "list_conversations": {
      if (!ctx.userId) throw new Error("userId required");
      const convs = listConversationsForUser(getCoreDb(), ctx.userId);
      const limit = args.limit != null ? Number(args.limit) : undefined;
      return limit ? convs.slice(0, limit) : convs;
    }

    case "read_conversation": {
      if (!ctx.userId) throw new Error("userId required");
      const conversationId = String(args.conversationId ?? "");
      getConversationForUser(getCoreDb(), conversationId, ctx.userId);
      return listDmMessages(getCoreDb(), conversationId, ctx.userId, {
        limit: args.limit != null ? Number(args.limit) : 50,
        before: args.before ? String(args.before) : undefined,
      });
    }

    case "send_message": {
      if (!ctx.userId) throw new Error("userId required");
      return createDmMessage(getCoreDb(), {
        conversationId: String(args.conversationId ?? ""),
        senderUserId: ctx.userId,
        bodyText: String(args.body ?? ""),
      });
    }

    case "create_conversation": {
      if (!ctx.userId) throw new Error("userId required");
      const kind = args.kind === "group" ? "group" : "direct";
      const memberUserIds = Array.isArray(args.memberUserIds)
        ? args.memberUserIds.map(String)
        : [];
      const memberAgents = Array.isArray(args.memberAgentIds)
        ? (args.memberAgentIds as string[]).map((agentId) => ({
            agentId,
            agentTenantId: ctx.tenantId ?? "",
          }))
        : [];
      return createConversation(getCoreDb(), {
        creatorUserId: ctx.userId,
        kind,
        title: args.title ? String(args.title) : null,
        memberUserIds,
        memberAgents,
      });
    }

    case "list_hooks":
      return listHooks(hookScope(ctx));

    case "create_hook": {
      // Default the owner to the active agent so a self-loop hook works even
      // when the model omits ownerKind/ownerId. triggerKind defaults to
      // 'schedule' (the self-loop case) and actionKind to 'run_agent'.
      const agentId = ctx.activeAgentId ?? "intelligence";
      const ownerKind = args.ownerKind === "user" ? "user" : "agent";
      const ownerId = String(
        args.ownerId ?? (ownerKind === "agent" ? agentId : ctx.userId ?? "")
      ).trim();
      const triggerKind = args.triggerKind === "event" ? "event" : "schedule";
      const actionKind = String(
        args.actionKind ?? "run_agent"
      ) as import("../core-db.js").HookActionKind;
      const name = String(args.name ?? "").trim() || `${agentId}-self-loop`;

      // Conditional-required validation with a concrete corrective example so a
      // missing field returns actionable guidance instead of a dead-end.
      if (triggerKind === "schedule" && !args.scheduleCron) {
        return {
          error:
            "A schedule hook requires `scheduleCron` (a cron expression, e.g. '*/5 * * * *').",
          example: {
            ownerKind: "agent",
            ownerId: agentId,
            name,
            triggerKind: "schedule",
            scheduleCron: "*/5 * * * *",
            actionKind: "run_agent",
            actionConfigJson: JSON.stringify({
              agentId,
              prompt:
                "Continue the backtest-iterate loop: check the latest run, tune paramsOverride if 0 trades, re-run; stop when it takes trades.",
            }),
          },
        };
      }
      if (triggerKind === "event" && !args.eventType) {
        return {
          error:
            "An event hook requires `eventType` (the event name to listen for). For a timer-based self-loop use triggerKind:'schedule' with scheduleCron instead.",
          example: {
            ownerKind: "agent",
            ownerId: agentId,
            name,
            triggerKind: "event",
            eventType: "backtest.completed",
            actionKind: "run_agent",
            actionConfigJson: JSON.stringify({ agentId, prompt: "..." }),
          },
        };
      }
      // run_agent needs agentId+prompt in actionConfigJson — synthesize a sane
      // default when the model omits it so the loop is actually runnable.
      let actionConfigJson = args.actionConfigJson
        ? String(args.actionConfigJson)
        : null;
      if (actionKind === "run_agent" && !actionConfigJson) {
        actionConfigJson = JSON.stringify({
          agentId,
          prompt:
            "Continue the current task loop: read the latest backtest run via list_backtest_runs/get_backtest_results, adjust paramsOverride and re-run if it took 0 trades, and disable this hook once it takes trades.",
        });
      }
      const created = createHook(
        {
          ownerKind,
          ownerId,
          ownerTenantId: ctx.tenantId ?? null,
          name,
          enabled: args.enabled !== false,
          triggerKind,
          eventType: args.eventType ? String(args.eventType) : null,
          scheduleCron: args.scheduleCron ? String(args.scheduleCron) : null,
          actionKind,
          actionConfigJson,
        },
        hookScope(ctx)
      );
      // Register the new cron immediately — the tool path (unlike the HTTP
      // route) must refresh the scheduler or a schedule self-loop never fires
      // until the next Bridge restart.
      refreshScheduler();
      return created;
    }

    case "update_hook": {
      const updated = updateHook(
        String(args.id ?? ""),
        args as Record<string, unknown>,
        hookScope(ctx)
      );
      refreshScheduler();
      return updated;
    }

    case "delete_hook":
      deleteHook(String(args.id ?? ""), hookScope(ctx));
      refreshScheduler();
      return { ok: true };

    case "list_hook_runs":
      return listHookRuns(String(args.hookId ?? ""), hookScope(ctx));

    case "emit_event": {
      const agentId = ctx.activeAgentId ?? "intelligence";
      return emitEvent({
        type: String(args.type ?? ""),
        actor: ctx.userId
          ? { kind: "user", id: ctx.userId }
          : { kind: "agent", id: agentId },
        tenantId: ctx.tenantId ?? null,
        payload: (args.payload as Record<string, unknown>) ?? {},
      });
    }

    case "list_events": {
      const agentId = ctx.activeAgentId ?? "intelligence";
      const owner = ctx.userId
        ? { kind: "user" as const, id: ctx.userId, tenantId: ctx.tenantId ?? null }
        : { kind: "agent" as const, id: agentId, tenantId: ctx.tenantId ?? null };
      return listEventsForOwner(owner, {
        limit: args.limit != null ? Number(args.limit) : undefined,
      });
    }

    case "list_holdings":
      return createFinancialServices(ctx.db).holdings.list();

    case "get_net_worth":
      return { netWorthCad: createFinancialServices(ctx.db).holdings.netWorthCad() };

    case "create_holding":
      return createFinancialServices(ctx.db).holdings.create({
        category: String(args.category ?? "manual") as "manual",
        provider: String(args.provider ?? "manual"),
        label: String(args.label ?? ""),
        currency: String(args.currency ?? "CAD"),
        balance: Number(args.balance ?? 0),
        balanceCad: Number(args.balanceCad ?? 0),
        reference: args.reference ? String(args.reference) : undefined,
      });

    case "refresh_holdings": {
      const fin = createFinancialServices(ctx.db);
      const conn = fin.holdings.get(String(args.connectionId ?? ""));
      if (!conn) throw new Error("Connection not found");
      if (conn.category === "wallet" && conn.reference) {
        const portfolio = await fin.crypto.fetchPortfolio(conn.reference);
        return fin.holdings.updateBalance(
          conn.id,
          portfolio.totalUsd,
          "USD",
          portfolio.totalCad,
          { tokens: portfolio.tokens }
        );
      }
      if (conn.category === "paypal") {
        const balance = await fin.paypal.fetchBalance();
        return fin.holdings.updateBalance(
          conn.id,
          balance.total,
          balance.currency,
          balance.totalCad,
          balance.raw
        );
      }
      throw new Error("Refresh not supported for this connection type");
    }

    case "search_marketplace": {
      const core = getCoreDb();
      const q = args.q ? String(args.q).toLowerCase() : "";
      const kind = args.kind ? String(args.kind) : undefined;
      let sql = `SELECT id, kind, title, description, price_credits, delivery_mode
                 FROM marketplace_listings WHERE status='active' AND visibility='public'`;
      const params: unknown[] = [];
      if (kind) {
        sql += ` AND kind=?`;
        params.push(kind);
      }
      sql += ` ORDER BY created_at DESC LIMIT 100`;
      let rows = core.prepare(sql).all(...params) as Array<Record<string, unknown>>;
      if (q) {
        rows = rows.filter(
          (r) =>
            String(r.title ?? "").toLowerCase().includes(q) ||
            String(r.description ?? "").toLowerCase().includes(q)
        );
      }
      return { listings: rows };
    }

    case "list_my_listings": {
      if (!ctx.userId) throw new Error("userId required");
      const rows = getCoreDb()
        .prepare(
          `SELECT id, kind, title, description, price_credits, status
           FROM marketplace_listings WHERE seller_user_id=? AND status='active'
           ORDER BY created_at DESC`
        )
        .all(ctx.userId);
      return { listings: rows };
    }

    case "create_listing": {
      if (!ctx.userId || !ctx.tenantId) throw new Error("user and tenant required");
      const kind = String(args.kind ?? "");
      const resourceId = args.resourceId ? String(args.resourceId) : undefined;
      const delivery = String(args.deliveryMode ?? "clone");
      let bundleJson = "{}";
      let title = String(args.title ?? kind);
      if (delivery === "clone" && resourceId) {
        const bundle = exportEntity(ctx.db, kind as MarketplaceListingKind, resourceId);
        title = String(args.title ?? bundle.title);
        bundleJson = JSON.stringify(bundle);
      }
      const id = uuidv4();
      getCoreDb()
        .prepare(
          `INSERT INTO marketplace_listings
             (id, seller_user_id, seller_tenant_id, kind, resource_id, title, description,
              price_credits, bundle_json, visibility, status, delivery_mode, pricing_model)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'public', 'active', ?, 'one_time')`
        )
        .run(
          id,
          ctx.userId,
          ctx.tenantId,
          kind,
          resourceId ?? id,
          title,
          args.description ? String(args.description) : null,
          Number(args.priceCredits ?? 0),
          bundleJson,
          delivery
        );
      return { id };
    }

    case "install_catalog_entry": {
      if (!ctx.userId || !ctx.tenantId || !ctx.db) throw new Error("user, tenant, and db required");
      return installCatalogEntry(getCoreDb(), ctx.db, {
        userId: ctx.userId,
        tenantId: ctx.tenantId,
        entryId: String(args.entryId ?? ""),
        sourceCatalog:
          typeof args.sourceCatalog === "string" ? args.sourceCatalog : undefined,
      });
    }

    case "list_available_plugins": {
      if (!ctx.tenantId) throw new Error("tenant required");
      const core = getCoreDb();
      return {
        available: listAvailablePlugins(),
        installed: listInstalledPlugins(core, ctx.tenantId),
      };
    }

    case "scaffold_plugin": {
      return scaffoldPlugin({
        id: String(args.id ?? ""),
        name: String(args.name ?? ""),
        departments: Array.isArray(args.departments)
          ? args.departments.map(String)
          : undefined,
        tenantId: ctx.tenantId,
      });
    }

    case "install_plugin": {
      if (!ctx.tenantId) throw new Error("tenant required");
      const pluginId = String(args.pluginId ?? "").trim();
      if (!pluginId) throw new Error("pluginId required");
      const pluginRoot =
        typeof args.pluginRoot === "string" && args.pluginRoot.trim()
          ? path.resolve(args.pluginRoot.trim())
          : defaultPluginRoot(pluginId, { tenantId: ctx.tenantId });
      const result = await activatePluginForTenant(
        getCoreDb(),
        ctx.tenantId,
        pluginRoot,
        { buildIfNeeded: true, installForTenant: true }
      );
      return { ok: true, ...result };
    }

    case "build_plugin": {
      const pluginRoot =
        typeof args.pluginRoot === "string" && args.pluginRoot.trim()
          ? path.resolve(args.pluginRoot.trim())
          : args.pluginId
            ? defaultPluginRoot(String(args.pluginId), { tenantId: ctx.tenantId })
            : "";
      if (!pluginRoot) throw new Error("pluginRoot or pluginId required");
      const built = await buildPluginWithEsbuild(pluginRoot);
      return {
        ...built,
        next: "Call install_plugin to load at runtime and enable for this tenant (no Bridge restart).",
      };
    }

    case "prepare_marketplace_submission": {
      return prepareMarketplaceSubmission({
        id: String(args.id ?? ""),
        title: String(args.title ?? ""),
        description: String(args.description ?? ""),
        pluginRepo: typeof args.pluginRepo === "string" ? args.pluginRepo : undefined,
      });
    }

    case "get_llm_status":
      if (!ctx.llm) throw new Error("LLM manager not available");
      return ctx.llm.getStatus();

    case "list_models":
      if (!ctx.llm) throw new Error("LLM manager not available");
      return { models: ctx.llm.scanModels() };

    case "scan_models":
      if (!ctx.llm) throw new Error("LLM manager not available");
      return { models: ctx.llm.scanModels() };

    case "start_llm": {
      if (!ctx.llm) throw new Error("LLM manager not available");
      const modelPath = String(args.modelPath ?? "");
      if (!modelPath) throw new Error("modelPath required");
      return ctx.llm.start(modelPath);
    }

    case "stop_llm":
      if (!ctx.llm) throw new Error("LLM manager not available");
      return ctx.llm.stop();

    case "restart_llm":
      if (!ctx.llm) throw new Error("LLM manager not available");
      return ctx.llm.restart(args.modelPath ? String(args.modelPath) : undefined);

    case "list_inference_endpoints": {
      if (!ctx.userId) throw new Error("userId required");
      return { endpoints: listInferenceEndpoints(getCoreDb(), ctx.userId) };
    }

    default: {
      if (isKernelToolName(name)) {
        try {
          const installedPluginIds = new Set(
            ctx.tenantId
              ? installedPluginIdsForTenant(getCoreDb(), ctx.tenantId)
              : []
          );
          const runKernel = () =>
            Promise.resolve(
              executeKernelTool(
                ctx.db,
                name,
                args,
                {
                  ...kernelOperationContext(ctx),
                  installedPluginIds,
                }
              )
            );
          const objectType = objectTypeForKernelTool(name, args);
          const isMutation =
            name.startsWith("create_") ||
            name.startsWith("update_") ||
            name.startsWith("delete_");
          if (objectType === "StructureNode" && isMutation) {
            const data =
              args.data && typeof args.data === "object"
                ? (args.data as Record<string, unknown>)
                : args;
            const parentId =
              data.parent_id != null ? String(data.parent_id) : undefined;
            const targetId = args.id != null ? String(args.id) : undefined;
            const scopeId = parentId ?? targetId;
            const departmentId = scopeId?.split("-")[0];
            const scope = departmentId ? { departmentId } : undefined;
            const result = await runPlatform(
              ctx,
              name,
              scope,
              args,
              runKernel
            );
            if (result !== undefined) return result;
          } else {
            const result = await runKernel();
            if (result !== undefined) return result;
          }
        } catch (err) {
          if (err instanceof KernelError) throw new Error(err.message);
          throw err;
        }
      }
      if (isPluginToolName(name)) {
        const result = await executePluginTool(name, args, pluginExecCtx(ctx));
        if (result !== undefined) return result;
      }
      // Corrective (not fatal) so a hallucinated tool name routes the model back
      // to the real registry on its next step instead of dead-ending the turn.
      const suggestions = suggestToolNames(name);
      return {
        error: `Unknown tool: "${name}". This tool is not registered. Use only tools from the Available tools list.`,
        ...(suggestions.length ? { didYouMean: suggestions } : {}),
      };
    }
  }
}

/** Closest registered tool names to a (possibly hallucinated) name. */
function suggestToolNames(name: string): string[] {
  const target = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const scored = AI_TOOL_REGISTRY.map((t) => {
    const n = t.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    let score = 0;
    if (n === target) score = 100;
    else if (n.includes(target) || target.includes(n)) score = 60;
    else {
      // crude token overlap
      const a = new Set(t.name.toLowerCase().split(/[_-]/));
      const b = new Set(name.toLowerCase().split(/[_-]/));
      for (const tok of a) if (b.has(tok)) score += 20;
    }
    return { name: t.name, score };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((s) => s.name);
  return scored;
}

export function requiresConfirmation(name: string): boolean {
  return toolMode(name) === "confirm";
}

export function listAdapterPaths(): string[] {
  const dir = config.ai.adaptersDir;
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".gguf"))
    .map((f) => path.join(dir, f));
}
