import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from "@xyflow/react";
import { FlowCanvas, FlowInspector, FlowWorkspace } from "@/components/flow";
import {
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  LayoutGridIcon,
  PlusIcon,
  RotateCwIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useStructure } from "@/lib/structure-context";
import { useTenant } from "@/lib/tenant-context";
import { userAgentIdForUser, isUserAgentId } from "@/lib/structure-agents";
import { flattenStructureNodes } from "@/lib/structure-adapters";
import {
  createAiAgent,
  deleteAiAgent,
  fetchAiAgents,
  setNodeAgent,
  updateAiAgent,
  type AiAgent,
} from "@/api";
import type { StructureNode } from "@/lib/navigation";
import { orgChartNodeTypes } from "./nodes";
import { OrgCollapseContext } from "./nodes/collapse-context";
import {
  clearOrgChartPositions,
  loadOrgChartCollapsed,
  loadOrgChartPositions,
  saveOrgChartCollapsed,
  saveOrgChartPositions,
} from "./graph";
import {
  layoutOrgChart,
  ORG_ROOT_AGENT_ID,
  AGENT_NODE_W,
  type AgentNodeData,
} from "./orgchart";

export interface AgentsOrgChartProps {
  embedded?: boolean;
  agentsVersion?: number;
}

function countOwnedPages(agentId: string, nodes: StructureNode[]): number {
  return flattenStructureNodes(nodes).filter((n) => n.agentId === agentId).length;
}

export function AgentsOrgChart({ embedded = false, agentsVersion = 0 }: AgentsOrgChartProps) {
  const { nodes: structureNodes, reload: reloadStructure } = useStructure();
  const { user } = useTenant();
  const personaId = user ? userAgentIdForUser(user.id) : null;
  const [agents, setAgents] = useState<AiAgent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newAgentName, setNewAgentName] = useState("");
  const rfRef = useRef<ReactFlowInstance | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(loadOrgChartCollapsed() ?? [])
  );
  const collapsedReadyRef = useRef(loadOrgChartCollapsed() !== null);
  const relayoutRef = useRef(false);
  const fitRef = useRef(false);

  const flatPages = useMemo(
    () => flattenStructureNodes(structureNodes),
    [structureNodes]
  );

  const loadAgents = useCallback(() => {
    fetchAiAgents()
      .then((r) => setAgents(r.agents))
      .catch(() => setAgents([]));
  }, []);

  useEffect(() => {
    loadAgents();
  }, [loadAgents, agentsVersion]);

  const refreshAll = useCallback(async () => {
    loadAgents();
    await reloadStructure();
  }, [loadAgents, reloadStructure]);

  const agentById = useMemo(() => {
    const m = new Map<string, AiAgent>();
    for (const a of agents) m.set(a.id, a);
    return m;
  }, [agents]);

  const hierarchy = useMemo(() => {
    const parent = new Map<string, string>();
    const children = new Map<string, string[]>();
    const chartAgents = agents.filter(
      (a) => !isUserAgentId(a.id) || a.id === personaId
    );
    for (const a of chartAgents) {
      if (a.id.startsWith("user-")) continue;
      const pid = a.parentId ?? ORG_ROOT_AGENT_ID;
      if (a.id === ORG_ROOT_AGENT_ID) continue;
      parent.set(a.id, pid);
      const list = children.get(pid) ?? [];
      list.push(a.id);
      children.set(pid, list);
    }
    return { parent, children };
  }, [agents, personaId]);

  const defaultCollapsed = useCallback((): Set<string> => {
    const next = new Set<string>();
    for (const id of hierarchy.children.keys()) next.add(id);
    return next;
  }, [hierarchy]);

  useEffect(() => {
    const root = agents.find((a) => a.id === ORG_ROOT_AGENT_ID);
    if (!root) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const builtNodes: Node[] = [];
    const structuralEdges: Edge[] = [];

    const chartAgents = agents.filter(
      (a) => !isUserAgentId(a.id) || a.id === personaId
    );

    for (const agent of chartAgents) {
      const isPersona = agent.id.startsWith("user-");
      builtNodes.push({
        id: agent.id,
        type: "agent",
        position: { x: 0, y: 0 },
        data: {
          kind: "agent",
          agentId: agent.id,
          name: agent.name,
          description: agent.description,
          isRoot: isPersona || agent.id === ORG_ROOT_AGENT_ID,
          team: isPersona ? "You" : agent.team,
          backend: agent.backend,
          ownedCount: countOwnedPages(agent.id, structureNodes),
        } satisfies AgentNodeData,
      });
      if (isPersona) continue;
      if (agent.id !== ORG_ROOT_AGENT_ID) {
        const parentId = agent.parentId ?? ORG_ROOT_AGENT_ID;
        structuralEdges.push({
          id: `tree:${parentId}:${agent.id}`,
          source: parentId,
          target: agent.id,
          data: { structural: true },
        });
      }
    }

    let activeCollapsed = collapsed;
    if (!collapsedReadyRef.current) {
      activeCollapsed = defaultCollapsed();
      collapsedReadyRef.current = true;
      setCollapsed(activeCollapsed);
    }

    const isVisible = (id: string): boolean => {
      let cur = hierarchy.parent.get(id);
      while (cur) {
        if (activeCollapsed.has(cur)) return false;
        cur = hierarchy.parent.get(cur);
      }
      return true;
    };

    const visibleNodes = builtNodes
      .filter((n) => isVisible(n.id))
      .map((n) => {
        const childCount = hierarchy.children.get(n.id)?.length ?? 0;
        return {
          ...n,
          data: {
            ...n.data,
            hasChildren: childCount > 0,
            collapsed: activeCollapsed.has(n.id),
            childCount,
          },
        };
      });
    const visibleIds = new Set(visibleNodes.map((n) => n.id));
    const visibleStructural = structuralEdges.filter(
      (e) => visibleIds.has(e.source) && visibleIds.has(e.target)
    );

    const relayout = relayoutRef.current;
    relayoutRef.current = false;
    const saved = relayout ? {} : loadOrgChartPositions();
    const layout = layoutOrgChart(visibleNodes, visibleStructural);
    const positioned = visibleNodes.map((n) => ({
      ...n,
      position: saved[n.id] ?? layout[n.id] ?? n.position,
    }));
    if (personaId) {
      const intel = positioned.find((n) => n.id === ORG_ROOT_AGENT_ID);
      const persona = positioned.find((n) => n.id === personaId);
      if (intel && persona && !saved[personaId]) {
        persona.position = {
          x: intel.position.x + AGENT_NODE_W + 36,
          y: intel.position.y,
        };
      }
    }

    setNodes((current) =>
      positioned.map((built) => {
        const existing = current.find((n) => n.id === built.id);
        return {
          ...built,
          position: relayout ? built.position : existing?.position ?? built.position,
          selected: existing?.selected ?? false,
        };
      })
    );
    setEdges(visibleStructural);

    if (fitRef.current) {
      fitRef.current = false;
      requestAnimationFrame(() => rfRef.current?.fitView({ padding: 0.15 }));
    }
  }, [agents, structureNodes, collapsed, hierarchy, defaultCollapsed, setNodes, setEdges, personaId]);

  const onNodeDragStop = useCallback(() => {
    const positions = loadOrgChartPositions();
    for (const n of nodes) positions[n.id] = { x: n.position.x, y: n.position.y };
    saveOrgChartPositions(positions);
  }, [nodes]);

  const onTidy = useCallback(() => {
    clearOrgChartPositions();
    const structural = edges.filter(
      (e) => (e.data as { structural?: boolean } | undefined)?.structural
    );
    const layout = layoutOrgChart(nodes, structural);
    setNodes((nds) => nds.map((n) => ({ ...n, position: layout[n.id] ?? n.position })));
    requestAnimationFrame(() => rfRef.current?.fitView({ padding: 0.15 }));
  }, [nodes, edges, setNodes]);

  const applyCollapsed = useCallback((next: Set<string>) => {
    clearOrgChartPositions();
    collapsedReadyRef.current = true;
    relayoutRef.current = true;
    fitRef.current = true;
    setCollapsed(next);
    saveOrgChartCollapsed([...next]);
  }, []);

  const toggleCollapsed = useCallback(
    (id: string) => {
      const next = new Set(collapsed);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      applyCollapsed(next);
    },
    [collapsed, applyCollapsed]
  );

  const expandAll = useCallback(() => applyCollapsed(new Set()), [applyCollapsed]);
  const collapseAll = useCallback(
    () => applyCollapsed(defaultCollapsed()),
    [applyCollapsed, defaultCollapsed]
  );

  const descendantsOf = useCallback(
    (id: string): Set<string> => {
      const out = new Set<string>([id]);
      const stack = [id];
      while (stack.length) {
        const cur = stack.pop() as string;
        for (const child of hierarchy.children.get(cur) ?? []) {
          if (!out.has(child)) {
            out.add(child);
            stack.push(child);
          }
        }
      }
      return out;
    },
    [hierarchy]
  );

  const reparentAgent = useCallback(
    (childId: string, parentId: string | null) => {
      if (isUserAgentId(childId) || childId === ORG_ROOT_AGENT_ID) {
        toast.error("This agent cannot be reparented");
        return;
      }
      const normalizedParent = parentId ?? ORG_ROOT_AGENT_ID;
      if (descendantsOf(childId).has(normalizedParent)) {
        toast.error("Cannot move an agent under its own descendant");
        return;
      }
      clearOrgChartPositions();
      relayoutRef.current = true;
      fitRef.current = true;
      void updateAiAgent(childId, { parentId: normalizedParent })
        .then(() => refreshAll())
        .then(() => toast.success("Agent moved"))
        .catch((err) => toast.error(err instanceof Error ? err.message : "Failed to move agent"));
    },
    [descendantsOf, refreshAll]
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      const { source, target } = conn;
      if (!source || !target || source === target) return;
      reparentAgent(target, source);
    },
    [reparentAgent]
  );

  const parentOptions = useMemo(
    () =>
      agents
        .filter((a) => a.id !== selectedAgentId)
        .map((a) => ({ id: a.id, label: a.name })),
    [agents, selectedAgentId]
  );

  const selectedAgent = selectedAgentId ? agentById.get(selectedAgentId) ?? null : null;

  useEffect(() => {
    if (selectedAgent) setNameDraft(selectedAgent.name);
  }, [selectedAgent]);

  const ownedPageIds = useMemo(() => {
    if (!selectedAgentId) return new Set<string>();
    return new Set(
      flatPages.filter((p) => p.agentId === selectedAgentId).map((p) => p.id)
    );
  }, [flatPages, selectedAgentId]);

  const saveName = useCallback(
    (agent: AiAgent) => {
      const trimmed = nameDraft.trim();
      if (!trimmed || trimmed === agent.name) return;
      void updateAiAgent(agent.id, { name: trimmed })
        .then(refreshAll)
        .catch((err) => toast.error(err instanceof Error ? err.message : "Failed to rename"));
    },
    [nameDraft, refreshAll]
  );

  const toggleOwnedPage = useCallback(
    (page: StructureNode, checked: boolean) => {
      if (!selectedAgentId) return;
      void setNodeAgent(page.id, checked ? selectedAgentId : null)
        .then(refreshAll)
        .catch((err) => toast.error(err instanceof Error ? err.message : "Failed to update page"));
    },
    [selectedAgentId, refreshAll]
  );

  const handleDelete = useCallback(
    (agent: AiAgent) => {
      if (agent.id === ORG_ROOT_AGENT_ID || isUserAgentId(agent.id)) return;
      if (!confirm(`Delete agent "${agent.name}"?`)) return;
      void deleteAiAgent(agent.id)
        .then(() => {
          setSelectedAgentId(null);
          return refreshAll();
        })
        .then(() => toast.success("Agent deleted"))
        .catch((err) => toast.error(err instanceof Error ? err.message : "Failed to delete"));
    },
    [refreshAll]
  );

  const handleCreateAgent = useCallback(() => {
    const name = newAgentName.trim();
    if (!name) return;
    const parentId = selectedAgentId ?? ORG_ROOT_AGENT_ID;
    void createAiAgent({
      name,
      cloneFromId: ORG_ROOT_AGENT_ID,
      parentId,
    })
      .then((created) => {
        setCreateOpen(false);
        setNewAgentName("");
        clearOrgChartPositions();
        relayoutRef.current = true;
        fitRef.current = true;
        return refreshAll().then(() => created.id);
      })
      .then((id) => {
        setSelectedAgentId(id);
        toast.success("Agent created");
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Failed to create agent"));
  }, [newAgentName, selectedAgentId, refreshAll]);

  const forbiddenParents = useMemo(
    () => (selectedAgent ? descendantsOf(selectedAgent.id) : new Set<string>()),
    [selectedAgent, descendantsOf]
  );

  const canvas = (
    <OrgCollapseContext.Provider value={{ toggle: toggleCollapsed }}>
      <FlowCanvas
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        nodeTypes={orgChartNodeTypes}
        onInit={(inst) => {
          rfRef.current = inst;
        }}
        onNodeClick={(_e, node) => {
          setSelectedAgentId(node.id);
          setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === node.id })));
        }}
        onPaneClick={() => {
          setSelectedAgentId(null);
          setNodes((nds) => nds.map((n) => ({ ...n, selected: false })));
        }}
        fitViewOptions={{ padding: 0.15 }}
        actions={
          <>
            <Button variant="default" size="sm" onClick={() => setCreateOpen(true)}>
              <PlusIcon data-icon="inline-start" />
              Add agent
            </Button>
            <Button variant="outline" size="sm" onClick={expandAll}>
              <ChevronsUpDownIcon data-icon="inline-start" />
              Expand all
            </Button>
            <Button variant="outline" size="sm" onClick={collapseAll}>
              <ChevronsDownUpIcon data-icon="inline-start" />
              Collapse all
            </Button>
            <Button variant="outline" size="sm" onClick={onTidy}>
              <LayoutGridIcon data-icon="inline-start" />
              Tidy
            </Button>
            <Button variant="outline" size="sm" onClick={() => void refreshAll()}>
              <RotateCwIcon data-icon="inline-start" />
              Refresh
            </Button>
          </>
        }
      />
    </OrgCollapseContext.Provider>
  );

  const inspector = !selectedAgent ? (
    <FlowInspector
      emptyDescription="Select an agent to rename it, assign owned pages, or change its parent. Drag from one agent to another to nest it under that parent."
    />
  ) : (
    <FlowInspector
      title={selectedAgent.name}
      subtitle={selectedAgent.id === ORG_ROOT_AGENT_ID ? "Root agent" : "Agent"}
    >
      <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label className="text-[11px] text-muted-foreground">Name</Label>
                <Input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={() => saveName(selectedAgent)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  className="h-8 text-xs"
                  disabled={selectedAgent.id === ORG_ROOT_AGENT_ID}
                />
              </div>

              {selectedAgent.id !== ORG_ROOT_AGENT_ID && (
                <div className="flex flex-col gap-1.5">
                  <Label className="text-[11px] text-muted-foreground">Parent</Label>
                  <Select
                    value={selectedAgent.parentId ?? ORG_ROOT_AGENT_ID}
                    onValueChange={(v) =>
                      reparentAgent(
                        selectedAgent.id,
                        v === ORG_ROOT_AGENT_ID ? ORG_ROOT_AGENT_ID : v
                      )
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value={ORG_ROOT_AGENT_ID}>Intelligence (root)</SelectItem>
                        {parentOptions
                          .filter((o) => !forbiddenParents.has(o.id))
                          .map((o) => (
                            <SelectItem key={o.id} value={o.id}>
                              {o.label}
                            </SelectItem>
                          ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="flex flex-col gap-2">
                <Label className="text-[11px] text-muted-foreground">Owns pages</Label>
                <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border p-2">
                  {flatPages.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">No pages in structure.</p>
                  ) : (
                    flatPages.map((page) => (
                      <label
                        key={page.id}
                        className="flex cursor-pointer items-start gap-2 text-xs"
                      >
                        <Checkbox
                          checked={ownedPageIds.has(page.id)}
                          onCheckedChange={(v) => toggleOwnedPage(page, Boolean(v))}
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{page.label}</span>
                          <span className="block truncate text-[10px] text-muted-foreground">
                            {page.path}
                          </span>
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              {selectedAgent.id !== ORG_ROOT_AGENT_ID && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="w-full"
                  onClick={() => handleDelete(selectedAgent)}
                >
                  <Trash2Icon data-icon="inline-start" />
                  Delete agent
                </Button>
              )}
      </div>
    </FlowInspector>
  );

  const createDialog = createOpen ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm rounded-lg border bg-background p-4 shadow-lg">
        <h3 className="text-sm font-semibold">New agent</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Cloned from Intelligence and nested under{" "}
          {selectedAgent?.name ?? "Intelligence"}.
        </p>
        <Input
          className="mt-3 h-8 text-xs"
          placeholder="Agent name"
          value={newAgentName}
          onChange={(e) => setNewAgentName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreateAgent();
            if (e.key === "Escape") setCreateOpen(false);
          }}
          autoFocus
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleCreateAgent} disabled={!newAgentName.trim()}>
            Create
          </Button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <FlowWorkspace
      bordered={!embedded}
      canvas={canvas}
      inspector={inspector}
      extra={createDialog}
    />
  );
}
