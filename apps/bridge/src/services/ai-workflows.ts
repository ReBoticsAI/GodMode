import type { EventEmitter } from "node:events";
import { v4 as uuidv4 } from "uuid";
import type { AppDatabase } from "../db.js";
import type { LlmManager } from "./llm-manager.js";
import { executeTool, type ToolExecContext } from "./ai-tool-executor.js";
import { runSubagent } from "./agents/runner.js";

/**
 * Workflows are directed graphs executed by a stateful, ready-queue runner.
 * Supported node kinds:
 *   trigger   → seeds the run with input text/data
 *   prompt    → single-shot LLM completion; interpolates {{input}}/{{nodeId}}
 *   tool      → runs a registered platform tool (ai-tool-executor)
 *   output    → terminal node; its incoming value becomes the run result
 *   condition → evaluates a safe predicate and fires the matching true/false edge
 *   loop      → iterates over an array, firing the "each" edge per item then "done"
 *   agent     → runs the tool-using agent loop (runAgentChat) with an allow-list
 *   pause     → human gate; persists run state and returns early (awaiting_input)
 *
 * Edges may carry an optional `label`. condition emits "true"/"false"; loop emits
 * "each"/"done"; pause resumes on "approved"/"changes". Unlabeled edges always fire
 * (legacy linear graphs reduce to the old BFS behavior).
 */
export type WorkflowNodeType =
  | "trigger"
  | "prompt"
  | "tool"
  | "output"
  | "condition"
  | "loop"
  | "agent"
  | "pause";

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  label?: string;
  config?: Record<string, unknown>;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  /** Branch label. condition: "true"/"false"; loop: "each"/"done"; pause: "approved"/"changes". */
  label?: string;
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  /** Optional event names that should trigger this workflow via the scheduler. */
  triggerEvents?: string[];
}

export interface AiWorkflow {
  id: string;
  agent_id: string | null;
  name: string;
  config: WorkflowGraph;
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface WorkflowRow {
  id: string;
  agent_id: string | null;
  name: string;
  config_json: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

function rowToWorkflow(row: WorkflowRow): AiWorkflow {
  let config: WorkflowGraph = { nodes: [], edges: [] };
  try {
    const parsed = JSON.parse(row.config_json) as WorkflowGraph;
    config = { nodes: parsed.nodes ?? [], edges: parsed.edges ?? [], triggerEvents: parsed.triggerEvents };
  } catch {
    /* keep empty */
  }
  return {
    id: row.id,
    agent_id: row.agent_id,
    name: row.name,
    config,
    enabled: row.enabled,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listWorkflows(db: AppDatabase): AiWorkflow[] {
  const rows = db
    .prepare(
      `SELECT id, agent_id, name, config_json, enabled, created_at, updated_at
       FROM ai_workflows ORDER BY updated_at DESC`
    )
    .all() as WorkflowRow[];
  return rows.map(rowToWorkflow);
}

export function getWorkflow(db: AppDatabase, id: string): AiWorkflow | null {
  const row = db
    .prepare(
      `SELECT id, agent_id, name, config_json, enabled, created_at, updated_at
       FROM ai_workflows WHERE id = ?`
    )
    .get(id) as WorkflowRow | undefined;
  return row ? rowToWorkflow(row) : null;
}

export function createWorkflow(
  db: AppDatabase,
  input: {
    name: string;
    agentId?: string | null;
    config?: WorkflowGraph;
    enabled?: boolean;
  }
): AiWorkflow {
  const id = uuidv4();
  const config: WorkflowGraph = input.config ?? { nodes: [], edges: [] };
  db.prepare(
    `INSERT INTO ai_workflows (id, agent_id, name, config_json, enabled)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    id,
    input.agentId ?? null,
    input.name,
    JSON.stringify(config),
    input.enabled === false ? 0 : 1
  );
  return getWorkflow(db, id)!;
}

export function updateWorkflow(
  db: AppDatabase,
  id: string,
  patch: {
    agentId?: string | null;
    name?: string;
    config?: WorkflowGraph;
    enabled?: boolean;
  }
): AiWorkflow | null {
  if (!getWorkflow(db, id)) return null;
  if (patch.name != null)
    db.prepare(`UPDATE ai_workflows SET name = ?, updated_at = datetime('now') WHERE id = ?`).run(
      String(patch.name),
      id
    );
  if (patch.agentId !== undefined)
    db.prepare(
      `UPDATE ai_workflows SET agent_id = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(patch.agentId, id);
  if (patch.config != null)
    db.prepare(
      `UPDATE ai_workflows SET config_json = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(JSON.stringify(patch.config), id);
  if (patch.enabled != null)
    db.prepare(
      `UPDATE ai_workflows SET enabled = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(patch.enabled ? 1 : 0, id);
  return getWorkflow(db, id);
}

export function deleteWorkflow(db: AppDatabase, id: string): boolean {
  return db.prepare(`DELETE FROM ai_workflows WHERE id = ?`).run(id).changes > 0;
}

export interface WorkflowRunResult {
  ok: boolean;
  output: string;
  nodeOutputs: Record<string, string>;
  /** Set when the run parked on a pause node. */
  awaiting?: boolean;
  runId?: string;
  error?: string;
}

export interface WorkflowExecDeps {
  db: AppDatabase;
  llm: LlmManager;
  bridgePort?: number;
  /** Optional event bus for ai_notification emissions on pause/failure. */
  bus?: EventEmitter;
}

/** Hard cap on total node executions per (resume)invocation; catches runaway cycles. */
const GLOBAL_NODE_BUDGET = 500;
/** Hard cap on pause→resume rounds before refusing to continue. */
const MAX_RESUME_ROUNDS = 12;

/** Serializable run state (Sets become arrays so it survives JSON round-trips). */
interface RunState {
  nodeOutputs: Record<string, string>;
  nodeJson: Record<string, unknown>;
  inputFor: Record<string, string>;
  pending: string[];
  loopCursors: Record<string, { index: number; items: unknown[] }>;
  visited: Record<string, number>;
  lastOutput: string;
  resumeRounds: number;
  cardId?: string | null;
}

function freshState(triggerInput: string, cardId?: string | null): RunState {
  return {
    nodeOutputs: {},
    nodeJson: {},
    inputFor: {},
    pending: [],
    loopCursors: {},
    visited: {},
    lastOutput: triggerInput,
    resumeRounds: 0,
    cardId: cardId ?? null,
  };
}

function resolvePath(root: unknown, path: string[]): unknown {
  let cur: unknown = root;
  for (const seg of path) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) cur = cur[Number(seg)];
    else if (typeof cur === "object") cur = (cur as Record<string, unknown>)[seg];
    else return undefined;
  }
  return cur;
}

/**
 * Interpolates {{input}}, {{nodeId}} (raw string output), and dotted JSON paths
 * {{nodeId.0.id}} resolved against parsed node JSON. Never executes code.
 */
function interpolate(
  template: string,
  input: string,
  nodeOutputs: Record<string, string>,
  nodeJson?: Record<string, unknown>
): string {
  let out = template.replace(/\{\{\s*input\s*\}\}/g, input);
  // Dotted paths first (e.g. {{list_backlog.0.id}}).
  out = out.replace(
    /\{\{\s*([\w-]+(?:\.[\w-]+)+)\s*\}\}/g,
    (_m, expr: string) => {
      const [head, ...rest] = expr.split(".");
      const root = nodeJson?.[head];
      const val = resolvePath(root, rest);
      if (val == null) return "";
      return typeof val === "string" ? val : JSON.stringify(val);
    }
  );
  // Simple {{nodeId}} references.
  out = out.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_m, key: string) => nodeOutputs[key] ?? "");
  return out;
}

/** Best-effort JSON parse used to expose tool/agent outputs to condition/loop refs. */
function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function resolveRef(state: RunState, ref: string): unknown {
  if (ref in state.nodeJson) return state.nodeJson[ref];
  return state.nodeOutputs[ref];
}

/** Safe, structured predicate evaluation — never uses eval. */
function evaluatePredicate(cfg: Record<string, unknown>, state: RunState): boolean {
  const ref = String(cfg.ref ?? "");
  const op = String(cfg.op ?? "non_empty");
  const value = cfg.value;
  const v = resolveRef(state, ref);
  switch (op) {
    case "non_empty":
      if (Array.isArray(v)) return v.length > 0;
      if (v && typeof v === "object") return Object.keys(v).length > 0;
      return v != null && String(v).trim() !== "" && String(v).trim() !== "[]";
    case "empty":
      if (Array.isArray(v)) return v.length === 0;
      return v == null || String(v).trim() === "" || String(v).trim() === "[]";
    case "gt":
      return Number(v) > Number(value);
    case "lt":
      return Number(v) < Number(value);
    case "eq":
      return String(v) === String(value);
    case "contains":
      return String(v).includes(String(value));
    default:
      return false;
  }
}

async function runPromptNode(
  deps: WorkflowExecDeps,
  promptText: string,
  adapterScales?: Array<{ id: number; scale: number }>
): Promise<string> {
  if (!deps.llm.isReady()) {
    throw new Error("LLM server not running");
  }
  const sampling = deps.llm.getSamplingParams();
  const body: Record<string, unknown> = {
    model: "default",
    messages: [{ role: "user", content: promptText }],
    stream: false,
    temperature: sampling.temperature,
    top_p: sampling.topP,
    top_k: sampling.topK,
    min_p: sampling.minP,
    repeat_penalty: sampling.repeatPenalty,
    max_tokens: sampling.maxTokens > 0 ? sampling.maxTokens : undefined,
  };
  if (adapterScales?.length) body.lora = adapterScales;
  const res = await fetch(`${deps.llm.getServerBaseUrl()}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content ?? "";
}

/** Dangerous tools that must NEVER be auto-approved inside an autonomous run. */
const NEVER_AUTO_APPROVE = new Set([
  "flatten_all",
  "flatten_playbook",
  "deploy_playbook",
]);

async function runAgentNode(
  deps: WorkflowExecDeps,
  cfg: Record<string, unknown>,
  input: string,
  state: RunState
): Promise<string> {
  const promptText = interpolate(
    String(cfg.prompt ?? "{{input}}"),
    input,
    state.nodeOutputs,
    state.nodeJson
  );
  let agentId = cfg.agentId ? String(cfg.agentId) : "intelligence";
  if (!cfg.agentId && state.cardId) {
    const row = deps.db
      .prepare(`SELECT assigned_agent_id FROM ai_project_cards WHERE id = ?`)
      .get(state.cardId) as { assigned_agent_id: string | null } | undefined;
    if (row?.assigned_agent_id) agentId = row.assigned_agent_id;
  }
  const allow = Array.isArray(cfg.autoApproveTools)
    ? (cfg.autoApproveTools as unknown[]).map((t) => String(t))
    : [];
  return runSubagent({
    db: deps.db,
    llm: deps.llm,
    agentId,
    prompt: promptText,
    systemExtra: cfg.system ? String(cfg.system) : undefined,
    toolCtx: { db: deps.db, bridgePort: deps.bridgePort, llm: deps.llm },
    maxIterations: Number(cfg.maxIterations ?? 8),
    onConfirmRequired: async ({ name }) =>
      allow.includes(name) && !NEVER_AUTO_APPROVE.has(name),
  });
}

/** Records a node's output into the run state (string + best-effort JSON view). */
function recordOutput(state: RunState, nodeId: string, output: string): void {
  state.nodeOutputs[nodeId] = output;
  const parsed = tryParseJson(output);
  if (parsed !== undefined) state.nodeJson[nodeId] = parsed;
  state.lastOutput = output;
}

function outEdges(graph: WorkflowGraph, nodeId: string): WorkflowEdge[] {
  return graph.edges.filter((e) => e.from === nodeId);
}

function fireEdges(state: RunState, edges: WorkflowEdge[], output: string): void {
  for (const edge of edges) {
    state.inputFor[edge.to] = output;
    if (!state.pending.includes(edge.to)) state.pending.push(edge.to);
  }
}

/** Resolve a card id for the Review UI from a node ref's JSON output. */
function resolveCardId(state: RunState, cfg: Record<string, unknown>): string | null {
  const ref = cfg.cardRef ? String(cfg.cardRef) : null;
  const candidates: unknown[] = [];
  if (ref) candidates.push(resolveRef(state, ref));
  for (const v of candidates) {
    if (Array.isArray(v) && v[0] && typeof v[0] === "object") {
      const id = (v[0] as { id?: unknown }).id;
      if (id) return String(id);
    }
    if (v && typeof v === "object") {
      const id = (v as { id?: unknown }).id;
      if (id) return String(id);
    }
  }
  return null;
}

function persistRunState(
  db: AppDatabase,
  runId: string,
  patch: {
    status?: string;
    state?: RunState;
    awaitingNodeId?: string | null;
    cardId?: string | null;
    result?: unknown;
    error?: string | null;
  }
): void {
  const sets: string[] = ["updated_at = datetime('now')"];
  const params: unknown[] = [];
  if (patch.status != null) {
    sets.push("status = ?");
    params.push(patch.status);
  }
  if (patch.state != null) {
    sets.push("state_json = ?");
    params.push(JSON.stringify(patch.state));
  }
  if (patch.awaitingNodeId !== undefined) {
    sets.push("awaiting_node_id = ?");
    params.push(patch.awaitingNodeId);
  }
  if (patch.cardId !== undefined) {
    sets.push("card_id = ?");
    params.push(patch.cardId);
  }
  if (patch.result !== undefined) {
    sets.push("result_json = ?");
    params.push(JSON.stringify(patch.result));
  }
  if (patch.error !== undefined) {
    sets.push("error = ?");
    params.push(patch.error);
  }
  params.push(runId);
  db.prepare(`UPDATE ai_workflow_runs SET ${sets.join(", ")} WHERE id = ?`).run(
    ...params
  );
}

/**
 * Core ready-queue runner. Drives `state.pending` until it drains or a pause
 * node parks the run. Returns early with `awaiting: true` on pause so the serial
 * queue worker is freed (the human-wait never blocks here).
 */
async function runLoop(
  deps: WorkflowExecDeps,
  wf: AiWorkflow,
  state: RunState,
  runId: string
): Promise<WorkflowRunResult> {
  const byId = new Map(wf.config.nodes.map((n) => [n.id, n]));
  // Attribute tool side-effects (events, notifications, cards) to the workflow's
  // OWNING agent rather than the default 'intelligence'. Without this, events
  // emitted from a sierra-chart workflow showed up as actor 'intelligence'.
  const ownerAgentId =
    (
      deps.db
        .prepare(`SELECT agent_id FROM ai_workflows WHERE id = ?`)
        .get(wf.id) as { agent_id: string | null } | undefined
    )?.agent_id ?? undefined;
  const toolCtx: ToolExecContext = {
    db: deps.db,
    bridgePort: deps.bridgePort,
    ...(ownerAgentId ? { activeAgentId: ownerAgentId } : {}),
  };
  let finalOutput = state.lastOutput;
  let executions = 0;

  try {
    while (state.pending.length) {
      if (++executions > GLOBAL_NODE_BUDGET) {
        throw new Error(`Workflow exceeded node-execution budget (${GLOBAL_NODE_BUDGET})`);
      }
      const nodeId = state.pending.shift()!;
      const node = byId.get(nodeId);
      if (!node) continue;
      state.visited[nodeId] = (state.visited[nodeId] ?? 0) + 1;
      const cfg = node.config ?? {};
      const input = state.inputFor[nodeId] ?? state.lastOutput;

      switch (node.type) {
        case "trigger": {
          const seed = cfg.input != null && String(cfg.input) !== "" ? String(cfg.input) : input;
          recordOutput(state, nodeId, seed);
          fireEdges(state, outEdges(wf.config, nodeId), seed);
          break;
        }
        case "prompt": {
          const tmpl = String(cfg.prompt ?? cfg.text ?? "{{input}}");
          const promptText = interpolate(tmpl, input, state.nodeOutputs, state.nodeJson);
          const scales = Array.isArray(cfg.lora)
            ? (cfg.lora as Array<{ id: number; scale: number }>)
            : undefined;
          const out = await runPromptNode(deps, promptText, scales);
          recordOutput(state, nodeId, out);
          fireEdges(state, outEdges(wf.config, nodeId), out);
          break;
        }
        case "tool": {
          const toolName = String(cfg.tool ?? cfg.name ?? "");
          const rawArgs = (cfg.args as Record<string, unknown>) ?? {};
          const interpolated: Record<string, unknown> = {};
          for (const [k, val] of Object.entries(rawArgs)) {
            interpolated[k] =
              typeof val === "string"
                ? interpolate(val, input, state.nodeOutputs, state.nodeJson)
                : val;
          }
          const result = await executeTool(toolName, interpolated, toolCtx);
          const out = typeof result === "string" ? result : JSON.stringify(result);
          recordOutput(state, nodeId, out);
          fireEdges(state, outEdges(wf.config, nodeId), out);
          break;
        }
        case "agent": {
          const out = await runAgentNode(deps, cfg, input, state);
          recordOutput(state, nodeId, out);
          fireEdges(state, outEdges(wf.config, nodeId), out);
          break;
        }
        case "condition": {
          recordOutput(state, nodeId, input);
          const result = evaluatePredicate(cfg, state) ? "true" : "false";
          const edges = outEdges(wf.config, nodeId).filter(
            (e) => (e.label ?? "true") === result
          );
          fireEdges(state, edges, input);
          break;
        }
        case "loop": {
          let cursor = state.loopCursors[nodeId];
          if (!cursor) {
            const ref = String(cfg.ref ?? "");
            const raw = resolveRef(state, ref);
            let items: unknown[] = [];
            if (Array.isArray(raw)) items = raw;
            else if (raw && typeof raw === "object") {
              // Tools like list_subtasks return { subtasks: [...] }.
              const obj = raw as Record<string, unknown>;
              if (Array.isArray(obj.subtasks)) items = obj.subtasks;
              else if (Array.isArray(obj.cards)) items = obj.cards;
            }
            cursor = { index: 0, items };
            state.loopCursors[nodeId] = cursor;
          }
          const maxIter = Number(cfg.maxIterations ?? 25);
          recordOutput(state, nodeId, state.lastOutput);
          if (cursor.index < cursor.items.length && cursor.index < maxIter) {
            const item = cursor.items[cursor.index];
            cursor.index += 1;
            const itemStr =
              typeof item === "string" ? item : JSON.stringify(item);
            const eachEdges = outEdges(wf.config, nodeId).filter(
              (e) => e.label === "each"
            );
            fireEdges(state, eachEdges, itemStr);
          } else {
            delete state.loopCursors[nodeId];
            const doneEdges = outEdges(wf.config, nodeId).filter(
              (e) => e.label === "done"
            );
            fireEdges(state, doneEdges, state.lastOutput);
          }
          break;
        }
        case "pause": {
          // Park: persist state and return without firing outbound edges.
          recordOutput(state, nodeId, "awaiting_input");
          const cardId = resolveCardId(state, cfg);
          persistRunState(deps.db, runId, {
            status: "awaiting_input",
            state,
            awaitingNodeId: nodeId,
            cardId: cardId ?? undefined,
          });
          emitNotification(deps, {
            kind: "review_requested",
            runId,
            cardId: cardId ?? "",
            cardTitle: cardId ? cardTitle(deps.db, cardId) : "",
            workflowId: wf.id,
            message: String(cfg.message ?? "Task ready for review"),
            at: new Date().toISOString(),
          });
          return {
            ok: true,
            output: "awaiting_input",
            nodeOutputs: state.nodeOutputs,
            awaiting: true,
            runId,
          };
        }
        case "output": {
          finalOutput = input;
          recordOutput(state, nodeId, input);
          fireEdges(state, outEdges(wf.config, nodeId), input);
          break;
        }
        default:
          break;
      }
    }
    if (!finalOutput) finalOutput = state.lastOutput;
    persistRunState(deps.db, runId, {
      status: "done",
      state,
      result: { output: finalOutput },
      awaitingNodeId: null,
    });
    return { ok: true, output: finalOutput, nodeOutputs: state.nodeOutputs, runId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    persistRunState(deps.db, runId, { status: "failed", state, error: message });
    emitNotification(deps, {
      kind: "run_failed",
      runId,
      cardId: "",
      cardTitle: "",
      workflowId: wf.id,
      message: `Workflow run failed: ${message}`,
      at: new Date().toISOString(),
    });
    return {
      ok: false,
      output: state.lastOutput,
      nodeOutputs: state.nodeOutputs,
      runId,
      error: message,
    };
  }
}

function cardTitle(db: AppDatabase, cardId: string): string {
  const row = db
    .prepare(`SELECT title FROM ai_project_cards WHERE id = ?`)
    .get(cardId) as { title?: string } | undefined;
  return row?.title ?? "";
}

interface AiNotification {
  kind: "review_requested" | "run_failed";
  runId: string;
  cardId: string;
  cardTitle: string;
  workflowId: string;
  message: string;
  at: string;
}

function emitNotification(deps: WorkflowExecDeps, payload: AiNotification): void {
  try {
    deps.bus?.emit("ai_notification", payload);
  } catch {
    /* notifications are best-effort */
  }
}

/**
 * Starts a fresh workflow run. Creates the durable ai_workflow_runs row, seeds
 * the ready-queue with the trigger node, and drives it until completion or a
 * pause gate parks the run.
 */
export async function executeWorkflow(
  deps: WorkflowExecDeps,
  workflowId: string,
  triggerInput = "",
  ctx?: { cardId?: string }
): Promise<WorkflowRunResult> {
  const wf = getWorkflow(deps.db, workflowId);
  if (!wf) return { ok: false, output: "", nodeOutputs: {}, error: "Workflow not found" };

  const start =
    wf.config.nodes.find((n) => n.type === "trigger") ?? wf.config.nodes[0];
  if (!start) {
    return { ok: false, output: "", nodeOutputs: {}, error: "Workflow has no nodes" };
  }

  const runId = uuidv4();
  deps.db
    .prepare(
      `INSERT INTO ai_workflow_runs (id, workflow_id, status, trigger_input, state_json, card_id)
       VALUES (?, ?, 'running', ?, '{}', ?)`
    )
    .run(runId, workflowId, triggerInput, ctx?.cardId ?? null);

  const state = freshState(triggerInput, ctx?.cardId);
  state.inputFor[start.id] = triggerInput;
  state.pending.push(start.id);
  return runLoop(deps, wf, state, runId);
}

export interface ResumeDecision {
  decision: "approve" | "request_changes";
  comments?: string;
}

/**
 * Resumes a parked run after a human decision. Injects the decision as the pause
 * node's output, fires its "approved"/"changes" edges, and continues the runner.
 */
export async function resumeWorkflowRun(
  deps: WorkflowExecDeps,
  runId: string,
  decision: ResumeDecision
): Promise<WorkflowRunResult> {
  const row = deps.db
    .prepare(`SELECT * FROM ai_workflow_runs WHERE id = ?`)
    .get(runId) as
    | {
        workflow_id: string;
        status: string;
        state_json: string;
        awaiting_node_id: string | null;
      }
    | undefined;
  if (!row) return { ok: false, output: "", nodeOutputs: {}, error: "Run not found" };
  if (row.status !== "awaiting_input") {
    return {
      ok: false,
      output: "",
      nodeOutputs: {},
      error: `Run is not awaiting input (status=${row.status})`,
    };
  }
  const wf = getWorkflow(deps.db, row.workflow_id);
  if (!wf) return { ok: false, output: "", nodeOutputs: {}, error: "Workflow not found" };

  const cardIdRow = deps.db
    .prepare(`SELECT card_id FROM ai_workflow_runs WHERE id = ?`)
    .get(runId) as { card_id: string | null } | undefined;
  let state: RunState;
  try {
    state = {
      ...freshState("", cardIdRow?.card_id),
      ...(JSON.parse(row.state_json) as RunState),
    };
  } catch {
    state = freshState("", cardIdRow?.card_id);
  }
  const pauseId = row.awaiting_node_id;
  if (!pauseId) {
    return { ok: false, output: "", nodeOutputs: {}, error: "No awaiting node" };
  }

  state.resumeRounds = (state.resumeRounds ?? 0) + 1;
  if (state.resumeRounds > MAX_RESUME_ROUNDS) {
    persistRunState(deps.db, runId, {
      status: "failed",
      state,
      error: `Exceeded ${MAX_RESUME_ROUNDS} review rounds`,
    });
    return {
      ok: false,
      output: "",
      nodeOutputs: state.nodeOutputs,
      runId,
      error: "Too many review rounds",
    };
  }

  const label = decision.decision === "approve" ? "approved" : "changes";
  const output =
    label === "approved"
      ? "approved"
      : `changes_requested: ${decision.comments ?? ""}`;
  state.nodeOutputs[pauseId] = output;
  state.nodeJson[pauseId] = { decision: label, comments: decision.comments ?? "" };
  state.lastOutput = output;
  state.pending = [];

  const fired = wf.config.edges.filter(
    (e) => e.from === pauseId && e.label === label
  );
  fireEdges(state, fired, output);

  persistRunState(deps.db, runId, { status: "running", state, awaitingNodeId: null });
  return runLoop(deps, wf, state, runId);
}
