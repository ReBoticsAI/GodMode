import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import { FlowCanvas, FlowInspector, FlowPalette, FlowWorkspace } from "@/components/flow";
import {
  ArrowRightIcon,
  BotIcon,
  GitBranchIcon,
  MessageSquareIcon,
  PauseIcon,
  PlusIcon,
  RepeatIcon,
  WrenchIcon,
  ZapIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useIntelligence } from "@/lib/intelligence-context";
import {
  addWorkflowComment,
  createAiWorkflow,
  fetchAiWorkflows,
  fetchWorkflowComments,
  updateAiWorkflow,
  type AiWorkflow,
  type AiWorkflowComment,
} from "@/api";

type WorkflowNodeKind =
  | "trigger"
  | "prompt"
  | "tool"
  | "output"
  | "condition"
  | "loop"
  | "agent"
  | "pause";

interface WorkflowNodeData {
  kind: WorkflowNodeKind;
  label: string;
  /** trigger: event name or cron expression */
  trigger?: string;
  /** prompt / agent: text sent to the model */
  prompt?: string;
  /** tool: tool id to invoke */
  tool?: string;
  /** output: where the result is written */
  target?: "chat" | "memory" | "journal";
  /** condition/loop: node id whose output is inspected */
  ref?: string;
  /** condition operator */
  op?: "non_empty" | "empty" | "gt" | "lt" | "eq" | "contains";
  /** condition comparison value */
  value?: string;
  /** loop max iterations */
  maxIterations?: number;
  /** agent: system prompt */
  system?: string;
  /** agent: comma-separated tool allow-list auto-approved in autonomous runs */
  autoApproveTools?: string;
  /** pause: message + card ref */
  message?: string;
  cardRef?: string;
  [key: string]: unknown;
}

const NODE_META: Record<
  WorkflowNodeKind,
  { label: string; accent: string; icon: React.ComponentType<{ className?: string }> }
> = {
  trigger: { label: "Trigger", accent: "border-amber-500/50", icon: ZapIcon },
  prompt: { label: "Prompt", accent: "border-primary/50", icon: MessageSquareIcon },
  tool: { label: "Tool call", accent: "border-sky-500/50", icon: WrenchIcon },
  output: { label: "Output", accent: "border-emerald-500/50", icon: ArrowRightIcon },
  condition: { label: "Condition", accent: "border-violet-500/50", icon: GitBranchIcon },
  loop: { label: "Loop", accent: "border-orange-500/50", icon: RepeatIcon },
  agent: { label: "Agent", accent: "border-fuchsia-500/50", icon: BotIcon },
  pause: { label: "Pause / Review", accent: "border-rose-500/50", icon: PauseIcon },
};

function WorkflowNode({ data, selected }: NodeProps) {
  const d = data as WorkflowNodeData;
  const meta = NODE_META[d.kind] ?? NODE_META.prompt;
  const Icon = meta.icon;
  return (
    <div
      className={cn(
        "min-w-[150px] max-w-[200px] rounded-lg border bg-card px-2.5 py-2 text-card-foreground shadow-sm",
        meta.accent,
        selected && "ring-2 ring-primary"
      )}
    >
      {d.kind !== "trigger" && (
        <Handle type="target" position={Position.Left} className="!size-2" />
      )}
      <div className="flex items-center gap-1.5">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-xs font-semibold">{d.label}</span>
      </div>
      <div className="mt-0.5 text-[10px] capitalize leading-snug text-muted-foreground">
        {meta.label}
      </div>
      {/* Branch outputs: condition → true/false, loop → each/done. */}
      {d.kind === "condition" ? (
        <>
          <Handle
            type="source"
            id="true"
            position={Position.Right}
            style={{ top: "38%" }}
            className="!size-2 !bg-emerald-500"
          />
          <Handle
            type="source"
            id="false"
            position={Position.Right}
            style={{ top: "70%" }}
            className="!size-2 !bg-red-500"
          />
        </>
      ) : d.kind === "loop" ? (
        <>
          <Handle
            type="source"
            id="each"
            position={Position.Right}
            style={{ top: "38%" }}
            className="!size-2 !bg-orange-500"
          />
          <Handle
            type="source"
            id="done"
            position={Position.Right}
            style={{ top: "70%" }}
            className="!size-2 !bg-emerald-500"
          />
        </>
      ) : d.kind === "pause" ? (
        <>
          <Handle
            type="source"
            id="approved"
            position={Position.Right}
            style={{ top: "38%" }}
            className="!size-2 !bg-emerald-500"
          />
          <Handle
            type="source"
            id="changes"
            position={Position.Right}
            style={{ top: "70%" }}
            className="!size-2 !bg-amber-500"
          />
        </>
      ) : (
        d.kind !== "output" && (
          <Handle type="source" position={Position.Right} className="!size-2" />
        )
      )}
    </div>
  );
}

const nodeTypes = { workflow: WorkflowNode };

const DEFAULT_NODES: Node[] = [
  { id: "trigger", type: "workflow", position: { x: 0, y: 60 }, data: { kind: "trigger", label: "Trigger (event/schedule)" } },
  { id: "prompt", type: "workflow", position: { x: 220, y: 60 }, data: { kind: "prompt", label: "Prompt" } },
  { id: "tool", type: "workflow", position: { x: 440, y: 60 }, data: { kind: "tool", label: "Tool call" } },
  { id: "output", type: "workflow", position: { x: 660, y: 60 }, data: { kind: "output", label: "Output → chat/memory" } },
];

const DEFAULT_EDGES: Edge[] = [
  { id: "e-t-p", source: "trigger", target: "prompt", animated: true },
  { id: "e-p-tool", source: "prompt", target: "tool", animated: true },
  { id: "e-tool-out", source: "tool", target: "output", animated: true },
];

const PALETTE: WorkflowNodeKind[] = [
  "trigger",
  "prompt",
  "tool",
  "agent",
  "condition",
  "loop",
  "pause",
  "output",
];

const KNOWN_KINDS = new Set<WorkflowNodeKind>([
  "trigger",
  "prompt",
  "tool",
  "output",
  "condition",
  "loop",
  "agent",
  "pause",
]);

/** Build the executor `config` object for a node from its editor data. */
function nodeConfigFor(d: WorkflowNodeData): Record<string, unknown> {
  switch (d.kind) {
    case "trigger":
      return { input: "" };
    case "prompt":
      return { prompt: d.prompt ?? "" };
    case "tool":
      return { tool: d.tool ?? "" };
    case "output":
      return { target: d.target ?? "chat" };
    case "condition":
      return { ref: d.ref ?? "", op: d.op ?? "non_empty", value: d.value ?? "" };
    case "loop":
      return { ref: d.ref ?? "", maxIterations: Number(d.maxIterations ?? 25) };
    case "agent":
      return {
        system: d.system ?? "",
        prompt: d.prompt ?? "",
        maxIterations: Number(d.maxIterations ?? 8),
        autoApproveTools: (d.autoApproveTools ?? "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      };
    case "pause":
      return { message: d.message ?? "Task ready for review", cardRef: d.cardRef ?? "" };
    default:
      return {};
  }
}

/** Translate ReactFlow nodes → executor-shaped nodes (and keep position/data). */
function toExecGraph(nodes: Node[], edges: Edge[]) {
  const execNodes = nodes.map((n) => {
    const d = n.data as WorkflowNodeData;
    return {
      id: n.id,
      type: d.kind,
      label: d.label,
      config: nodeConfigFor(d),
      position: n.position,
      data: d,
    };
  });
  const execEdges = edges.map((e) => ({
    from: e.source,
    to: e.target,
    label: (e.sourceHandle ?? (e.label as string | undefined)) || undefined,
  }));
  const triggerEvents = nodes
    .filter((n) => (n.data as WorkflowNodeData).kind === "trigger")
    .map((n) => String((n.data as WorkflowNodeData).trigger ?? "").trim())
    .filter((t) => t && !t.includes(" ")); // exclude cron expressions
  return { nodes: execNodes, edges: execEdges, triggerEvents };
}

interface StoredNode {
  id: string;
  type?: string;
  label?: string;
  config?: Record<string, unknown>;
  position?: { x: number; y: number };
  data?: Partial<WorkflowNodeData>;
}
interface StoredEdge {
  id?: string;
  from?: string;
  to?: string;
  source?: string;
  target?: string;
  label?: string;
  sourceHandle?: string;
}

/** Tolerant loader: accepts both executor-shaped and legacy ReactFlow-shaped graphs. */
function toFlowGraph(
  storedNodes: StoredNode[],
  storedEdges: StoredEdge[]
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = storedNodes.map((n, i) => {
    const kindFromType = n.type && KNOWN_KINDS.has(n.type as WorkflowNodeKind)
      ? (n.type as WorkflowNodeKind)
      : undefined;
    const kind: WorkflowNodeKind =
      (n.data?.kind as WorkflowNodeKind) ?? kindFromType ?? "prompt";
    const cfg = n.config ?? {};
    const data: WorkflowNodeData = {
      kind,
      label: n.data?.label ?? n.label ?? NODE_META[kind].label,
      // executor config → editor fields
      prompt: (cfg.prompt as string) ?? n.data?.prompt,
      tool: (cfg.tool as string) ?? n.data?.tool,
      target: (cfg.target as WorkflowNodeData["target"]) ?? n.data?.target,
      ref: (cfg.ref as string) ?? n.data?.ref,
      op: (cfg.op as WorkflowNodeData["op"]) ?? n.data?.op,
      value: (cfg.value as string) ?? n.data?.value,
      maxIterations: (cfg.maxIterations as number) ?? n.data?.maxIterations,
      system: (cfg.system as string) ?? n.data?.system,
      autoApproveTools: Array.isArray(cfg.autoApproveTools)
        ? (cfg.autoApproveTools as string[]).join(", ")
        : n.data?.autoApproveTools,
      message: (cfg.message as string) ?? n.data?.message,
      cardRef: (cfg.cardRef as string) ?? n.data?.cardRef,
      trigger: n.data?.trigger,
    };
    return {
      id: n.id,
      type: "workflow",
      position: n.position ?? { x: 40 + (i % 4) * 220, y: 60 + Math.floor(i / 4) * 110 },
      data,
    };
  });
  const edges: Edge[] = storedEdges.map((e, i) => {
    const source = e.source ?? e.from ?? "";
    const target = e.target ?? e.to ?? "";
    const label = e.label ?? e.sourceHandle;
    return {
      id: e.id ?? `e-${source}-${target}-${i}`,
      source,
      target,
      sourceHandle: label,
      label,
      animated: true,
    };
  });
  return { nodes, edges };
}

export function WorkflowFlow() {
  const { activeAgentId } = useIntelligence();
  const [workflow, setWorkflow] = useState<AiWorkflow | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(DEFAULT_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(DEFAULT_EDGES);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comments, setComments] = useState<AiWorkflowComment[]>([]);
  const [composer, setComposer] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [showComments, setShowComments] = useState(false);

  useEffect(() => {
    fetchAiWorkflows(activeAgentId)
      .then(async (r) => {
        let wf = r.workflows[0] ?? null;
        if (!wf) {
          wf = await createAiWorkflow("Default workflow", undefined, activeAgentId);
        }
        setWorkflow(wf);
        try {
          const config = JSON.parse(wf.config_json) as {
            nodes?: StoredNode[];
            edges?: StoredEdge[];
          };
          if (config.nodes?.length) {
            const flow = toFlowGraph(config.nodes, config.edges ?? []);
            setNodes(flow.nodes);
            setEdges(flow.edges);
          } else {
            setNodes(DEFAULT_NODES);
            setEdges(DEFAULT_EDGES);
          }
        } catch {
          setNodes(DEFAULT_NODES);
          setEdges(DEFAULT_EDGES);
        }
      })
      .catch(() => undefined);
  }, [setNodes, setEdges, activeAgentId]);

  const workflowId = workflow?.id ?? null;
  const reloadComments = useCallback(async () => {
    if (!workflowId) {
      setComments([]);
      return;
    }
    try {
      const r = await fetchWorkflowComments(workflowId);
      setComments(r.comments);
    } catch {
      setComments([]);
    }
  }, [workflowId]);

  useEffect(() => {
    setComposer("");
    void reloadComments();
  }, [reloadComments]);

  const postComment = async () => {
    if (!workflowId || !composer.trim()) return;
    setCommentBusy(true);
    try {
      await addWorkflowComment(workflowId, composer.trim(), "user");
      setComposer("");
      await reloadComments();
    } finally {
      setCommentBusy(false);
    }
  };

  const onConnect = useCallback(
    (c: Connection) =>
      setEdges((eds) =>
        addEdge(
          {
            ...c,
            animated: true,
            // Branch handle id becomes the edge label (true/false/each/done/...).
            label: c.sourceHandle ?? undefined,
          },
          eds
        )
      ),
    [setEdges]
  );

  const addNode = useCallback(
    (kind: WorkflowNodeKind) => {
      const id = `${kind}-${Date.now().toString(36)}`;
      setNodes((nds) => [
        ...nds,
        {
          id,
          type: "workflow",
          position: { x: 40 + (nds.length % 4) * 60, y: 260 + Math.floor(nds.length / 4) * 90 },
          data: { kind, label: NODE_META[kind].label },
        },
      ]);
      setSelectedId(id);
    },
    [setNodes]
  );

  const updateNodeData = useCallback(
    (id: string, patch: Partial<WorkflowNodeData>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, ...patch } } : n
        )
      );
    },
    [setNodes]
  );

  const removeNode = useCallback(
    (id: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== id));
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
      setSelectedId(null);
    },
    [setNodes, setEdges]
  );

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;
  const selectedData = selectedNode?.data as WorkflowNodeData | undefined;
  const nodeIdOptions = useMemo(
    () => nodes.map((n) => n.id).filter((id) => id !== selectedId),
    [nodes, selectedId]
  );

  const save = async () => {
    if (!workflow) return;
    setSaving(true);
    try {
      const updated = await updateAiWorkflow(workflow.id, {
        config: toExecGraph(nodes, edges),
      });
      setWorkflow(updated);
    } finally {
      setSaving(false);
    }
  };

  const paletteItems = useMemo(() => PALETTE, []);

  const toolbar = (
    <>
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <div className="min-w-0">
          <span className="text-sm font-medium">{workflow?.name ?? "Workflow"}</span>
          <p className="text-xs text-muted-foreground">
            Wire trigger → prompt/agent/tool → output, then run from a Hook or Schedule.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={!workflow}
            onClick={() => setShowComments((v) => !v)}
          >
            <MessageSquareIcon className="mr-1 size-3" />
            Comments{comments.length > 0 ? ` (${comments.length})` : ""}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save workflow"}
          </Button>
        </div>
      </div>
      {workflow && showComments ? (
        <div className="shrink-0 border-b px-3 py-2">
          <div className="grid gap-1.5 rounded-md border p-2">
            <Label className="text-[11px]">Comments</Label>
            <div className="flex max-h-40 flex-col gap-1 overflow-auto">
              {comments.length === 0 && (
                <span className="text-[10px] text-muted-foreground">No comments yet.</span>
              )}
              {comments.map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    "rounded px-1.5 py-1 text-[11px]",
                    c.author === "user"
                      ? "bg-primary/10 text-foreground"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  <span className="mr-1 text-[9px] font-semibold uppercase opacity-60">
                    {c.author}
                  </span>
                  {c.body}
                </div>
              ))}
            </div>
            <Textarea
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              placeholder="Leave a comment…"
              className="min-h-[56px] text-[11px]"
            />
            <div className="flex">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => void postComment()}
                disabled={commentBusy || !composer.trim()}
              >
                Add comment
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );

  const palette = (
    <FlowPalette title="Add node" width="compact">
      {paletteItems.map((kind) => {
        const meta = NODE_META[kind];
        const Icon = meta.icon;
        return (
          <button
            key={kind}
            type="button"
            onClick={() => addNode(kind)}
            className={cn(
              "flex items-center gap-1.5 rounded-md border bg-card px-2 py-1.5 text-left text-xs hover:bg-muted/60",
              meta.accent
            )}
          >
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{meta.label}</span>
            <PlusIcon className="ml-auto size-3 shrink-0 text-muted-foreground" />
          </button>
        );
      })}
    </FlowPalette>
  );

  const canvas = (
    <FlowCanvas
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onNodeClick={(_e, node) => setSelectedId(node.id)}
      onPaneClick={() => setSelectedId(null)}
      fitViewOptions={{ padding: 0.2 }}
      backgroundGap={12}
    />
  );

  const inspector =
    !selectedData || !selectedNode ? (
      <FlowInspector
        width="wide"
        emptyDescription="Select a node to edit its parameters."
      />
    ) : (
      <FlowInspector
        width="wide"
        title={NODE_META[selectedData.kind].label}
        headerAction={
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px] text-destructive hover:text-destructive"
            onClick={() => removeNode(selectedNode.id)}
          >
            Delete
          </Button>
        }
      >
        <div className="flex flex-col gap-2.5">
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px]">Label</Label>
                  <Input
                    value={selectedData.label}
                    onChange={(e) => updateNodeData(selectedNode.id, { label: e.target.value })}
                    className="h-7 text-xs"
                  />
                </div>

                {selectedData.kind === "trigger" && (
                  <div className="flex flex-col gap-1">
                    <Label className="text-[11px]">Event or cron</Label>
                    <Input
                      value={selectedData.trigger ?? ""}
                      onChange={(e) => updateNodeData(selectedNode.id, { trigger: e.target.value })}
                      placeholder="pb_signal · sc_signal · 0 */1 * * *"
                      className="h-7 font-mono text-xs"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      A bridge event name (becomes a triggerEvent) or a cron expression.
                    </p>
                  </div>
                )}

                {selectedData.kind === "prompt" && (
                  <div className="flex flex-col gap-1">
                    <Label className="text-[11px]">Prompt</Label>
                    <Textarea
                      value={selectedData.prompt ?? ""}
                      onChange={(e) => updateNodeData(selectedNode.id, { prompt: e.target.value })}
                      rows={6}
                      placeholder="Use {{input}} or {{nodeId}} to interpolate."
                      className="font-mono text-[11px]"
                    />
                  </div>
                )}

                {selectedData.kind === "tool" && (
                  <div className="flex flex-col gap-1">
                    <Label className="text-[11px]">Tool id</Label>
                    <Input
                      value={selectedData.tool ?? ""}
                      onChange={(e) => updateNodeData(selectedNode.id, { tool: e.target.value })}
                      placeholder="e.g. list_project_cards"
                      className="h-7 font-mono text-xs"
                    />
                  </div>
                )}

                {selectedData.kind === "condition" && (
                  <>
                    <div className="flex flex-col gap-1">
                      <Label className="text-[11px]">Inspect node output</Label>
                      <Select
                        value={selectedData.ref ?? ""}
                        onValueChange={(v) => updateNodeData(selectedNode.id, { ref: v ?? "" })}
                      >
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue placeholder="Node id" />
                        </SelectTrigger>
                        <SelectContent>
                          {nodeIdOptions.map((id) => (
                            <SelectItem key={id} value={id}>
                              {id}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label className="text-[11px]">Operator</Label>
                      <Select
                        value={selectedData.op ?? "non_empty"}
                        onValueChange={(v) =>
                          updateNodeData(selectedNode.id, { op: v as WorkflowNodeData["op"] })
                        }
                      >
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="non_empty">is non-empty</SelectItem>
                          <SelectItem value="empty">is empty</SelectItem>
                          <SelectItem value="gt">greater than</SelectItem>
                          <SelectItem value="lt">less than</SelectItem>
                          <SelectItem value="eq">equals</SelectItem>
                          <SelectItem value="contains">contains</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {selectedData.op &&
                      ["gt", "lt", "eq", "contains"].includes(selectedData.op) && (
                        <div className="flex flex-col gap-1">
                          <Label className="text-[11px]">Value</Label>
                          <Input
                            value={selectedData.value ?? ""}
                            onChange={(e) =>
                              updateNodeData(selectedNode.id, { value: e.target.value })
                            }
                            className="h-7 text-xs"
                          />
                        </div>
                      )}
                    <p className="text-[10px] text-muted-foreground">
                      The green handle is the <code>true</code> branch; red is <code>false</code>.
                    </p>
                  </>
                )}

                {selectedData.kind === "loop" && (
                  <>
                    <div className="flex flex-col gap-1">
                      <Label className="text-[11px]">Iterate node output (array)</Label>
                      <Select
                        value={selectedData.ref ?? ""}
                        onValueChange={(v) => updateNodeData(selectedNode.id, { ref: v ?? "" })}
                      >
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue placeholder="Node id" />
                        </SelectTrigger>
                        <SelectContent>
                          {nodeIdOptions.map((id) => (
                            <SelectItem key={id} value={id}>
                              {id}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label className="text-[11px]">Max iterations</Label>
                      <Input
                        type="number"
                        value={selectedData.maxIterations ?? 25}
                        onChange={(e) =>
                          updateNodeData(selectedNode.id, {
                            maxIterations: Number(e.target.value),
                          })
                        }
                        className="h-7 text-xs"
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      The orange handle fires once per item (<code>each</code>); the green handle
                      fires when the list is exhausted (<code>done</code>). Wire the body back to
                      this loop node.
                    </p>
                  </>
                )}

                {selectedData.kind === "agent" && (
                  <>
                    <div className="flex flex-col gap-1">
                      <Label className="text-[11px]">System</Label>
                      <Textarea
                        value={selectedData.system ?? ""}
                        onChange={(e) => updateNodeData(selectedNode.id, { system: e.target.value })}
                        rows={3}
                        className="text-[11px]"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label className="text-[11px]">Prompt</Label>
                      <Textarea
                        value={selectedData.prompt ?? ""}
                        onChange={(e) => updateNodeData(selectedNode.id, { prompt: e.target.value })}
                        rows={4}
                        placeholder="Use {{input}} or {{nodeId}}."
                        className="font-mono text-[11px]"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label className="text-[11px]">Max iterations</Label>
                      <Input
                        type="number"
                        value={selectedData.maxIterations ?? 8}
                        onChange={(e) =>
                          updateNodeData(selectedNode.id, {
                            maxIterations: Number(e.target.value),
                          })
                        }
                        className="h-7 text-xs"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label className="text-[11px]">Auto-approve tools</Label>
                      <Input
                        value={selectedData.autoApproveTools ?? ""}
                        onChange={(e) =>
                          updateNodeData(selectedNode.id, { autoApproveTools: e.target.value })
                        }
                        placeholder="update_card, move_project_card"
                        className="h-7 font-mono text-[11px]"
                      />
                      <p className="text-[10px] text-muted-foreground">
                        Comma-separated. Dangerous tools (flatten_all, deploy_playbook) are never
                        auto-approved.
                      </p>
                    </div>
                  </>
                )}

                {selectedData.kind === "pause" && (
                  <>
                    <div className="flex flex-col gap-1">
                      <Label className="text-[11px]">Message</Label>
                      <Input
                        value={selectedData.message ?? ""}
                        onChange={(e) => updateNodeData(selectedNode.id, { message: e.target.value })}
                        placeholder="Task ready for review"
                        className="h-7 text-xs"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label className="text-[11px]">Card ref (node id)</Label>
                      <Select
                        value={selectedData.cardRef ?? ""}
                        onValueChange={(v) => updateNodeData(selectedNode.id, { cardRef: v ?? "" })}
                      >
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue placeholder="Node id producing the card" />
                        </SelectTrigger>
                        <SelectContent>
                          {nodeIdOptions.map((id) => (
                            <SelectItem key={id} value={id}>
                              {id}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Green handle = <code>approved</code>; amber = <code>changes</code>. Wire the
                      change branch back to this node for review loops.
                    </p>
                  </>
                )}

                {selectedData.kind === "output" && (
                  <div className="flex flex-col gap-1">
                    <Label className="text-[11px]">Write result to</Label>
                    <Select
                      value={selectedData.target ?? "chat"}
                      onValueChange={(v) =>
                        updateNodeData(selectedNode.id, { target: v as WorkflowNodeData["target"] })
                      }
                    >
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="chat">Chat</SelectItem>
                        <SelectItem value="memory">Memory</SelectItem>
                        <SelectItem value="journal">Journal</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

          <p className="mt-1 text-[10px] text-muted-foreground">
            Changes apply on “Save workflow”.
          </p>
        </div>
      </FlowInspector>
    );

  return (
    <FlowWorkspace
      bordered={false}
      toolbar={toolbar}
      palette={palette}
      canvas={canvas}
      inspector={inspector}
      className="h-full"
    />
  );
}
