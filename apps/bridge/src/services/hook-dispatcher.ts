import { v4 as uuidv4 } from "uuid";
import {
  getCoreDb,
  type CoreDatabase,
  type CoreEvent,
  type CoreHook,
  type HookRunStatus,
} from "../core-db.js";
import type { LlmManager } from "./llm-manager.js";
import type { AiQueueWorker } from "./ai-queue-worker.js";
import { createNotification } from "./notification-service.js";
import { getTenantDb } from "../tenant-registry.js";
import { runSubagent } from "./agents/runner.js";
import {
  createAgentMessage,
  createMessage,
  listConversationMemberUserIds,
} from "./dm-service.js";
import { getShareBroker } from "../ws-broker.js";

interface DispatcherDeps {
  llm?: LlmManager;
  bridgePort?: number;
  /** Serial AI queue worker; the `run_workflow` action enqueues onto it. */
  queue?: AiQueueWorker;
}

let deps: DispatcherDeps = {};

export function setDispatcherDeps(next: DispatcherDeps): void {
  deps = next;
}

/* --------------------------- event-type matching --------------------------- */

/** Exact match, or 'prefix.*' wildcard (e.g. 'dm.*' matches 'dm.message.created'). */
export function eventTypeMatches(pattern: string | null, type: string): boolean {
  if (!pattern) return false;
  if (pattern === type || pattern === "*") return true;
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -2);
    return type === prefix || type.startsWith(`${prefix}.`);
  }
  return false;
}

/**
 * Visibility rule (intentionally simple): a hook owner may act on an event when
 * the event is global (no tenant), or shares the owner's tenant, or the owner
 * is the actor that produced it.
 */
function ownerCanSeeEvent(hook: CoreHook, event: CoreEvent): boolean {
  if (!event.tenant_id) return true;
  if (hook.owner_tenant_id && hook.owner_tenant_id === event.tenant_id) return true;
  if (event.actor_kind === hook.owner_kind && event.actor_id === hook.owner_id) {
    return true;
  }
  return false;
}

/* ------------------------------ conditions -------------------------------- */

type Comparison = { field: string; op: string; value?: unknown };
type ConditionSpec = { all?: Comparison[]; any?: Comparison[] } | Comparison[] | null;

function getByPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function compare(actual: unknown, op: string, expected: unknown): boolean {
  switch (op) {
    case "eq":
      return actual === expected || String(actual) === String(expected);
    case "neq":
      return !(actual === expected || String(actual) === String(expected));
    case "contains":
      return typeof actual === "string" && actual.includes(String(expected));
    case "startsWith":
      return typeof actual === "string" && actual.startsWith(String(expected));
    case "gt":
      return Number(actual) > Number(expected);
    case "lt":
      return Number(actual) < Number(expected);
    case "exists":
      return actual !== undefined && actual !== null;
    default:
      return false;
  }
}

/** Safe declarative evaluator over the event payload. Never uses eval(). */
export function evaluateCondition(
  conditionJson: string | null,
  payload: Record<string, unknown>
): boolean {
  if (!conditionJson) return true;
  let spec: ConditionSpec;
  try {
    spec = JSON.parse(conditionJson) as ConditionSpec;
  } catch {
    return false;
  }
  if (!spec) return true;
  const checks: Comparison[] = Array.isArray(spec)
    ? spec
    : (spec.all ?? spec.any ?? []);
  if (checks.length === 0) return true;
  const useAny = !Array.isArray(spec) && !!spec.any && !spec.all;
  const results = checks.map((c) =>
    compare(getByPath(payload, c.field), c.op, c.value)
  );
  return useAny ? results.some(Boolean) : results.every(Boolean);
}

/* ------------------------------ rate limit -------------------------------- */

function isRateLimited(db: CoreDatabase, hook: CoreHook): boolean {
  if (!hook.rate_limit_per_hour || hook.rate_limit_per_hour <= 0) return false;
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM hook_runs
       WHERE hook_id = ?
         AND status IN ('success', 'pending_approval')
         AND created_at >= datetime('now', '-1 hour')`
    )
    .get(hook.id) as { n: number };
  return row.n >= hook.rate_limit_per_hour;
}

function recordRun(
  db: CoreDatabase,
  hookId: string,
  eventId: string | null,
  status: HookRunStatus,
  detail: string | null,
  result?: unknown
): string {
  const id = uuidv4();
  db.prepare(
    `INSERT INTO hook_runs (id, hook_id, event_id, status, detail, result_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    hookId,
    eventId,
    status,
    detail,
    result === undefined ? null : JSON.stringify(result)
  );
  return id;
}

/* -------------------------- template substitution -------------------------- */

function fillTemplate(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path: string) => {
    const v = getByPath(payload, path);
    return v === undefined || v === null ? "" : String(v);
  });
}

/* ------------------------------- actions ---------------------------------- */

interface ActionResult {
  status: HookRunStatus;
  detail: string;
  result?: unknown;
}

async function runActionNotify(
  hook: CoreHook,
  cfg: Record<string, unknown>,
  payload: Record<string, unknown>
): Promise<ActionResult> {
  const title = fillTemplate(String(cfg.title ?? hook.name), payload);
  const body = cfg.body ? fillTemplate(String(cfg.body), payload) : null;
  createNotification({
    recipientKind: hook.owner_kind,
    recipientId: hook.owner_id,
    recipientTenantId: hook.owner_tenant_id,
    category: "hook",
    title,
    body,
    link: typeof cfg.link === "string" ? cfg.link : null,
  });
  return { status: "success", detail: `Notified ${hook.owner_kind} ${hook.owner_id}` };
}

async function runActionRunAgent(
  hook: CoreHook,
  cfg: Record<string, unknown>,
  payload: Record<string, unknown>
): Promise<ActionResult> {
  const agentId = typeof cfg.agentId === "string" ? cfg.agentId : null;
  const promptTpl = typeof cfg.prompt === "string" ? cfg.prompt : "";
  if (!agentId) return { status: "error", detail: "run_agent: missing agentId" };
  const agentTenantId =
    (typeof cfg.agentTenantId === "string" && cfg.agentTenantId) ||
    hook.owner_tenant_id;
  if (!agentTenantId) {
    return { status: "error", detail: "run_agent: cannot resolve agent tenant" };
  }
  if (!deps.llm || !deps.llm.isReady()) {
    return {
      status: "error",
      detail: "run_agent: local LLM not ready; run skipped",
    };
  }
  const prompt = fillTemplate(promptTpl || "Hook triggered.", payload);
  const db = getTenantDb(agentTenantId);
  const answer = await runSubagent({
    db,
    llm: deps.llm,
    agentId,
    prompt,
    toolCtx: {
      db,
      bridgePort: deps.bridgePort,
      llm: deps.llm,
      activeAgentId: agentId,
      tenantId: agentTenantId,
    },
  });
  return {
    status: "success",
    detail: `Agent ${agentId} run completed`,
    result: { answer: answer.slice(0, 4000) },
  };
}

/**
 * Runs a stored AI workflow by enqueuing it onto the serial AI queue worker —
 * the same execution path the cron scheduler uses (worker → executeWorkflow).
 * Running async keeps the LLM serialized and never blocks the hook dispatch; the
 * resulting ai_workflow_run is observable in the Automations → Workflows tab.
 * Agent-owned hooks run in the agent's tenant (mirroring run_agent); the workflow
 * must live in the resolved tenant's workspace DB.
 */
async function runActionRunWorkflow(
  hook: CoreHook,
  cfg: Record<string, unknown>,
  payload: Record<string, unknown>
): Promise<ActionResult> {
  const workflowId = typeof cfg.workflowId === "string" ? cfg.workflowId : null;
  if (!workflowId) {
    return { status: "error", detail: "run_workflow: missing workflowId" };
  }
  if (!deps.queue) {
    return { status: "error", detail: "run_workflow: queue worker unavailable" };
  }
  const tenantId =
    (typeof cfg.workflowTenantId === "string" && cfg.workflowTenantId) ||
    (typeof cfg.agentTenantId === "string" && cfg.agentTenantId) ||
    hook.owner_tenant_id;
  if (!tenantId) {
    return { status: "error", detail: "run_workflow: cannot resolve workflow tenant" };
  }
  const inputsRaw =
    typeof cfg.inputs === "string"
      ? fillTemplate(cfg.inputs, payload)
      : cfg.inputs != null
        ? JSON.stringify(cfg.inputs)
        : "";
  const triggerInput =
    inputsRaw ||
    fillTemplate(typeof cfg.input === "string" ? cfg.input : "", payload);
  const jobId = deps.queue.enqueue({
    workflowId,
    prompt: triggerInput || undefined,
    context: { hookId: hook.id, eventType: payload.eventType ?? null },
    priority: 2,
    tenantId,
  });
  return {
    status: "success",
    detail: `Enqueued workflow ${workflowId} (job ${jobId})`,
    result: { jobId, workflowId, tenantId },
  };
}

async function runActionSendMessage(
  hook: CoreHook,
  cfg: Record<string, unknown>,
  payload: Record<string, unknown>
): Promise<ActionResult> {
  const conversationId =
    typeof cfg.conversationId === "string" ? cfg.conversationId : null;
  if (!conversationId) {
    return { status: "error", detail: "send_message: missing conversationId" };
  }
  const text = fillTemplate(String(cfg.text ?? ""), payload);
  if (!text.trim()) return { status: "error", detail: "send_message: empty text" };
  const core = getCoreDb();
  let messageId: string;
  if (hook.owner_kind === "agent") {
    const agentTenantId =
      (typeof cfg.agentTenantId === "string" && cfg.agentTenantId) ||
      hook.owner_tenant_id;
    if (!agentTenantId) {
      return { status: "error", detail: "send_message: agent tenant unresolved" };
    }
    const msg = createAgentMessage(core, {
      conversationId,
      agentId: hook.owner_id,
      agentTenantId,
      bodyText: text,
    });
    messageId = msg.id;
  } else {
    const msg = createMessage(core, {
      conversationId,
      senderUserId: hook.owner_id,
      bodyText: text,
    });
    messageId = msg.id;
  }
  const memberIds = listConversationMemberUserIds(core, conversationId);
  getShareBroker().broadcastResource("conversation", conversationId, {
    type: "dm_message",
    data: { conversationId },
    timestamp: Date.now(),
  });
  for (const uid of memberIds) {
    getShareBroker().broadcastToRoom(`user:${uid}`, {
      type: "dm_message",
      data: { conversationId },
      timestamp: Date.now(),
    });
  }
  return { status: "success", detail: `Sent message ${messageId}` };
}

async function runActionWebhook(
  cfg: Record<string, unknown>,
  payload: Record<string, unknown>
): Promise<ActionResult> {
  const url = typeof cfg.url === "string" ? cfg.url : null;
  if (!url) return { status: "error", detail: "webhook: missing url" };
  const method = typeof cfg.method === "string" ? cfg.method : "POST";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.headers && typeof cfg.headers === "object") {
    for (const [k, v] of Object.entries(cfg.headers as Record<string, unknown>)) {
      headers[k] = String(v);
    }
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: method === "GET" ? undefined : JSON.stringify(payload),
      signal: controller.signal,
    });
    return {
      status: res.ok ? "success" : "error",
      detail: `webhook ${method} ${url} -> ${res.status}`,
      result: { status: res.status },
    };
  } catch (err) {
    return {
      status: "error",
      detail: `webhook failed: ${(err as Error).message}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function dispatchAction(
  hook: CoreHook,
  payload: Record<string, unknown>
): Promise<ActionResult> {
  let cfg: Record<string, unknown> = {};
  if (hook.action_config_json) {
    try {
      cfg = JSON.parse(hook.action_config_json) as Record<string, unknown>;
    } catch {
      return { status: "error", detail: "invalid action_config_json" };
    }
  }
  switch (hook.action_kind) {
    case "notify":
      return runActionNotify(hook, cfg, payload);
    case "run_agent":
      return runActionRunAgent(hook, cfg, payload);
    case "run_workflow":
      return runActionRunWorkflow(hook, cfg, payload);
    case "send_message":
      return runActionSendMessage(hook, cfg, payload);
    case "webhook":
      return runActionWebhook(cfg, payload);
    default:
      return { status: "error", detail: `unknown action ${hook.action_kind}` };
  }
}

/**
 * Run one hook against a (possibly synthetic) event. Handles condition gating,
 * rate limiting, approval gating, and action execution + audit. Shared by the
 * event path and the scheduler.
 */
export async function executeHook(
  hook: CoreHook,
  event: CoreEvent | null,
  db: CoreDatabase = getCoreDb()
): Promise<void> {
  const payload: Record<string, unknown> = {
    eventType: event?.type ?? "schedule.tick",
    actorKind: event?.actor_kind ?? "system",
    actorId: event?.actor_id ?? null,
    tenantId: event?.tenant_id ?? null,
  };
  if (event?.payload_json) {
    try {
      Object.assign(payload, JSON.parse(event.payload_json) as object);
    } catch {
      /* ignore malformed payload */
    }
  }

  if (!evaluateCondition(hook.condition_json, payload)) {
    recordRun(db, hook.id, event?.id ?? null, "skipped", "condition not met");
    return;
  }

  if (isRateLimited(db, hook)) {
    recordRun(db, hook.id, event?.id ?? null, "skipped", "rate limit reached");
    return;
  }

  if (hook.require_approval) {
    const runId = recordRun(
      db,
      hook.id,
      event?.id ?? null,
      "pending_approval",
      "awaiting owner approval"
    );
    createNotification({
      recipientKind: hook.owner_kind,
      recipientId: hook.owner_id,
      recipientTenantId: hook.owner_tenant_id,
      category: "hook",
      title: `Approval needed: ${hook.name}`,
      body: `A "${hook.action_kind}" action is pending your approval.`,
      link: "/automations",
      resourceKind: "hook_run",
      resourceId: runId,
    });
    db.prepare(`UPDATE hooks SET last_fired_at = datetime('now') WHERE id = ?`).run(
      hook.id
    );
    return;
  }

  let result: ActionResult;
  try {
    result = await dispatchAction(hook, payload);
  } catch (err) {
    result = { status: "error", detail: (err as Error).message };
  }
  recordRun(db, hook.id, event?.id ?? null, result.status, result.detail, result.result);
  db.prepare(`UPDATE hooks SET last_fired_at = datetime('now') WHERE id = ?`).run(
    hook.id
  );
}

/** Approve a pending_approval run: execute its action now and log the outcome. */
export async function approveHookRun(
  runId: string,
  db: CoreDatabase = getCoreDb()
): Promise<void> {
  const run = db
    .prepare(`SELECT * FROM hook_runs WHERE id = ?`)
    .get(runId) as { id: string; hook_id: string; event_id: string | null; status: string } | undefined;
  if (!run || run.status !== "pending_approval") return;
  const hook = db.prepare(`SELECT * FROM hooks WHERE id = ?`).get(run.hook_id) as
    | CoreHook
    | undefined;
  if (!hook) return;
  const event = run.event_id
    ? (db.prepare(`SELECT * FROM events WHERE id = ?`).get(run.event_id) as CoreEvent | undefined) ?? null
    : null;
  const payload: Record<string, unknown> = {};
  if (event?.payload_json) {
    try {
      Object.assign(payload, JSON.parse(event.payload_json) as object);
    } catch {
      /* ignore */
    }
  }
  let result: ActionResult;
  try {
    result = await dispatchAction(hook, payload);
  } catch (err) {
    result = { status: "error", detail: (err as Error).message };
  }
  db.prepare(`UPDATE hook_runs SET status = ?, detail = ?, result_json = ? WHERE id = ?`).run(
    result.status,
    `approved: ${result.detail}`,
    result.result === undefined ? null : JSON.stringify(result.result),
    runId
  );
}

export function rejectHookRun(runId: string, db: CoreDatabase = getCoreDb()): void {
  db.prepare(
    `UPDATE hook_runs SET status = 'skipped', detail = 'rejected by owner'
     WHERE id = ? AND status = 'pending_approval'`
  ).run(runId);
}

/** Entry point for the event bus. */
export async function dispatchEvent(
  event: CoreEvent,
  db: CoreDatabase = getCoreDb()
): Promise<void> {
  const hooks = db
    .prepare(
      `SELECT * FROM hooks WHERE trigger_kind = 'event' AND enabled = 1`
    )
    .all() as CoreHook[];
  for (const hook of hooks) {
    if (!eventTypeMatches(hook.event_type, event.type)) continue;
    if (!ownerCanSeeEvent(hook, event)) continue;
    try {
      await executeHook(hook, event, db);
    } catch (err) {
      console.error(`[hook-dispatcher] hook ${hook.id} failed`, err);
    }
  }
}
