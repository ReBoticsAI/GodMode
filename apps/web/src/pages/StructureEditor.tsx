import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from "@xyflow/react";
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
import { ShareDialog } from "@/components/ShareDialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { IconPicker } from "@/components/IconPicker";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useStructure } from "@/lib/structure-context";
import {
  deleteStructureNode,
  fetchAiAgents,
  fetchStructureGraph,
  reparentStructureNode,
  saveStructureGraphLayout,
  setNodeAgent,
  updateStructureNode,
  type AiAgent,
} from "@/api";
import type { StructureNode } from "@/lib/navigation";
import { FlowCanvas, FlowInspector, FlowWorkspace } from "@/components/flow";
import { StructureCreateDialog, type StructureCreateOption } from "./intelligence-flow/StructureCreateDialog";
import { StructurePagePalette } from "./intelligence-flow/StructurePagePalette";
import { orgChartNodeTypes } from "./intelligence-flow/nodes";
import { OrgCollapseContext } from "./intelligence-flow/nodes/collapse-context";
import {
  clearOrgChartPositions,
  loadOrgChartCollapsed,
  loadOrgChartPositions,
  saveOrgChartCollapsed,
  saveOrgChartPositions,
} from "./intelligence-flow/graph";
import { layoutOrgChart, type PageNodeData } from "./intelligence-flow/orgchart";
import { Page, PageHeader } from "@/components/PageHeader";

const ROOT_AGENT_ID = "intelligence";
const NO_AGENT_VALUE = "__none__";
const ROOT_PARENT_VALUE = "__root__";

interface FlatNode {
  node: StructureNode;
  depth: number;
}

function flatten(nodes: StructureNode[], depth = 0, out: FlatNode[] = []): FlatNode[] {
  for (const n of nodes) {
    out.push({ node: n, depth });
    flatten(n.children, depth + 1, out);
  }
  return out;
}

export function StructureEditorChart() {
  const { nodes: structureNodes, reload: reloadStructure } = useStructure();
  const [agents, setAgents] = useState<AiAgent[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const rfRef = useRef<ReactFlowInstance | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(loadOrgChartCollapsed() ?? [])
  );
  const collapsedReadyRef = useRef(loadOrgChartCollapsed() !== null);
  const relayoutRef = useRef(false);
  const fitRef = useRef(false);
  const layoutHydratedRef = useRef(false);
  const layoutSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistLayoutToServer = useCallback(() => {
    const positions = loadOrgChartPositions();
    const collapsedList = loadOrgChartCollapsed() ?? [];
    const vp = rfRef.current?.getViewport();
    void saveStructureGraphLayout({
      version: 1,
      positions,
      collapsed: collapsedList,
      viewport: vp ? { x: vp.x, y: vp.y, zoom: vp.zoom } : undefined,
    }).catch(() => undefined);
  }, []);

  const scheduleLayoutSave = useCallback(() => {
    if (layoutSaveTimerRef.current) clearTimeout(layoutSaveTimerRef.current);
    layoutSaveTimerRef.current = setTimeout(() => {
      layoutSaveTimerRef.current = null;
      persistLayoutToServer();
    }, 600);
  }, [persistLayoutToServer]);

  useEffect(() => {
    if (layoutHydratedRef.current) return;
    fetchStructureGraph()
      .then((record) => {
        if (record.layout) {
          saveOrgChartPositions(record.layout.positions);
          saveOrgChartCollapsed(record.layout.collapsed);
          collapsedReadyRef.current = true;
          setCollapsed(new Set(record.layout.collapsed));
          relayoutRef.current = true;
          if (record.layout.viewport) {
            requestAnimationFrame(() =>
              rfRef.current?.setViewport(record.layout!.viewport!)
            );
          }
        }
      })
      .catch(() => undefined)
      .finally(() => {
        layoutHydratedRef.current = true;
      });
  }, []);

  const loadAgents = useCallback(() => {
    fetchAiAgents()
      .then((r) => setAgents(r.agents))
      .catch(() => setAgents([]));
  }, []);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const refreshAll = useCallback(async () => {
    loadAgents();
    await reloadStructure();
  }, [loadAgents, reloadStructure]);

  const flat = useMemo(() => flatten(structureNodes), [structureNodes]);

  const agentById = useMemo(() => {
    const m = new Map<string, AiAgent>();
    for (const a of agents) m.set(a.id, a);
    return m;
  }, [agents]);

  const rootAgentName = useMemo(() => {
    const root = agents.find((a) => a.id === ROOT_AGENT_ID || a.isTemplate);
    return root?.name ?? "Intelligence";
  }, [agents]);

  const nodeById = useMemo(() => {
    const m = new Map<string, StructureNode>();
    for (const f of flat) m.set(f.node.id, f.node);
    return m;
  }, [flat]);

  // Resolve the displayed owner: an explicitly attached agent, else the nearest
  // ancestor's agent, else the root Intelligence agent.
  const resolveOwner = useCallback(
    (node: StructureNode): { name: string; explicit: boolean } => {
      if (node.agentId) {
        return { name: agentById.get(node.agentId)?.name ?? node.agentId, explicit: true };
      }
      let cur = node.parentId ? nodeById.get(node.parentId) : undefined;
      while (cur) {
        if (cur.agentId) {
          return { name: agentById.get(cur.agentId)?.name ?? cur.agentId, explicit: false };
        }
        cur = cur.parentId ? nodeById.get(cur.parentId) : undefined;
      }
      return { name: rootAgentName, explicit: false };
    },
    [agentById, nodeById, rootAgentName]
  );

  const hierarchy = useMemo(() => {
    const parent = new Map<string, string>();
    const children = new Map<string, string[]>();
    for (const { node } of flat) {
      if (node.parentId) parent.set(node.id, node.parentId);
      const kids = node.children.map((c) => c.id);
      if (kids.length) children.set(node.id, kids);
    }
    return { parent, children };
  }, [flat]);

  // Default view: collapse every page that has children so only top-level pages
  // are visible (each shows a "+N" expand affordance).
  const defaultCollapsed = useCallback((): Set<string> => {
    const next = new Set<string>();
    for (const id of hierarchy.children.keys()) next.add(id);
    return next;
  }, [hierarchy]);

  useEffect(() => {
    if (flat.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const builtNodes: Node[] = [];
    const structuralEdges: Edge[] = [];

    for (const { node } of flat) {
      const owner = resolveOwner(node);
      builtNodes.push({
        id: node.id,
        type: "page",
        position: { x: 0, y: 0 },
        data: {
          kind: "page",
          nodeId: node.id,
          label: node.label,
          iconName: node.icon,
          agentId: node.agentId,
          ownerName: owner.name,
          explicit: owner.explicit,
          builtIn: node.builtIn,
        } satisfies PageNodeData,
      });
      if (node.parentId) {
        structuralEdges.push({
          id: `tree:${node.parentId}:${node.id}`,
          source: node.parentId,
          target: node.id,
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
  }, [flat, resolveOwner, collapsed, hierarchy, defaultCollapsed, setNodes, setEdges]);

  const onNodeDragStop = useCallback(() => {
    const positions = loadOrgChartPositions();
    for (const n of nodes) positions[n.id] = { x: n.position.x, y: n.position.y };
    saveOrgChartPositions(positions);
    scheduleLayoutSave();
  }, [nodes, scheduleLayoutSave]);

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
    scheduleLayoutSave();
  }, [scheduleLayoutSave]);

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

  const ensureVisible = useCallback(
    (id: string) => {
      const ancestors: string[] = [];
      let cur = hierarchy.parent.get(id);
      while (cur) {
        ancestors.push(cur);
        cur = hierarchy.parent.get(cur);
      }
      const collapsedAncestors = ancestors.filter((a) => collapsed.has(a));
      if (collapsedAncestors.length === 0) return;
      const next = new Set(collapsed);
      for (const a of collapsedAncestors) next.delete(a);
      applyCollapsed(next);
    },
    [hierarchy, collapsed, applyCollapsed]
  );

  const centerNode = useCallback(
    (id: string) => {
      const n = nodes.find((x) => x.id === id);
      if (n) rfRef.current?.setCenter(n.position.x + 100, n.position.y + 36, { zoom: 1, duration: 300 });
    },
    [nodes]
  );

  const selectNode = useCallback(
    (id: string) => {
      ensureVisible(id);
      setSelectedNodeId(id);
      setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === id })));
      requestAnimationFrame(() => centerNode(id));
    },
    [ensureVisible, centerNode, setNodes]
  );

  // Descendants of a node (forbidden as new parents to avoid cycles).
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

  const reparent = useCallback(
    (childId: string, parentId: string | null) => {
      if (parentId && descendantsOf(childId).has(parentId)) {
        toast.error("Cannot move a page under its own descendant");
        return;
      }
      clearOrgChartPositions();
      relayoutRef.current = true;
      fitRef.current = true;
      void reparentStructureNode(childId, parentId)
        .then(() => refreshAll())
        .then(() => toast.success("Page moved"))
        .catch((err) => toast.error(err instanceof Error ? err.message : "Failed to move page"));
    },
    [descendantsOf, refreshAll]
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      const { source, target } = conn;
      if (!source || !target || source === target) return;
      // Dragging source -> target makes the target a child of the source.
      reparent(target, source);
    },
    [reparent]
  );

  const openCreate = useCallback(() => {
    setCreateParentId(selectedNodeId);
    setCreateOpen(true);
  }, [selectedNodeId]);

  const handleStructureCreated = useCallback(
    (nodeId: string) => {
      clearOrgChartPositions();
      relayoutRef.current = true;
      fitRef.current = true;
      void refreshAll().then(() => {
        setTimeout(() => selectNode(nodeId), 100);
      });
    },
    [refreshAll, selectNode]
  );

  const parentOptions = useMemo<StructureCreateOption[]>(
    () => flat.map((f) => ({ id: f.node.id, label: f.node.label, depth: f.depth })),
    [flat]
  );

  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) ?? null : null;

  useEffect(() => {
    if (selectedNode) setLabelDraft(selectedNode.label);
  }, [selectedNode]);

  const selectedOwner = selectedNode ? resolveOwner(selectedNode) : null;

  const saveLabel = useCallback(
    (node: StructureNode) => {
      const trimmed = labelDraft.trim();
      if (!trimmed || trimmed === node.label) return;
      void updateStructureNode(node.id, { label: trimmed })
        .then(refreshAll)
        .catch((err) => toast.error(err instanceof Error ? err.message : "Failed to rename"));
    },
    [labelDraft, refreshAll]
  );

  const changeIcon = useCallback(
    (node: StructureNode, icon: string) => {
      void updateStructureNode(node.id, { icon })
        .then(refreshAll)
        .catch((err) => toast.error(err instanceof Error ? err.message : "Failed to update icon"));
    },
    [refreshAll]
  );

  const changeAgent = useCallback(
    (node: StructureNode, value: string) => {
      const agentId = value === NO_AGENT_VALUE ? null : value;
      void setNodeAgent(node.id, agentId)
        .then(refreshAll)
        .catch((err) => toast.error(err instanceof Error ? err.message : "Failed to set agent"));
    },
    [refreshAll]
  );

  const handleDelete = useCallback(
    (node: StructureNode) => {
      if (node.builtIn) return;
      const hasChildren = node.children.length > 0;
      if (
        !confirm(
          `Delete page "${node.label}"${hasChildren ? " and all of its child pages" : ""}?`
        )
      ) {
        return;
      }
      void deleteStructureNode(node.id)
        .then(() => {
          setSelectedNodeId(null);
          return refreshAll();
        })
        .then(() => toast.success("Page deleted"))
        .catch((err) => toast.error(err instanceof Error ? err.message : "Failed to delete"));
    },
    [refreshAll]
  );

  const forbiddenParents = useMemo(
    () => (selectedNode ? descendantsOf(selectedNode.id) : new Set<string>()),
    [selectedNode, descendantsOf]
  );

  const palette = (
    <StructurePagePalette
      nodes={structureNodes}
      selectedId={selectedNodeId}
      onSelect={selectNode}
      onAddPage={openCreate}
    />
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
        onNodeClick={(_e, node) => selectNode(node.id)}
        onPaneClick={() => setSelectedNodeId(null)}
        fitViewOptions={{ padding: 0.15 }}
        actions={
          <>
            <Button variant="default" size="sm" onClick={openCreate}>
              <PlusIcon data-icon="inline-start" />
              Add page
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

  const inspector = !selectedNode ? (
    <FlowInspector
      emptyDescription="Select a page to rename it, attach an agent, or change its parent. Drag from one page to another to nest it."
    />
  ) : (
    <FlowInspector
      title={selectedNode.label}
      subtitle="Page"
      headerAction={
        <ShareDialog
          resourceKind="page"
          resourceId={selectedNode.id}
          resourceLabel={selectedNode.label}
        />
      }
    >
      <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label className="text-[11px] text-muted-foreground">Label</Label>
                <Input
                  value={labelDraft}
                  onChange={(e) => setLabelDraft(e.target.value)}
                  onBlur={() => saveLabel(selectedNode)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  className="h-8 text-xs"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label className="text-[11px] text-muted-foreground">Icon</Label>
                <IconPicker
                  value={selectedNode.icon}
                  onChange={(icon) => changeIcon(selectedNode, icon)}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label className="text-[11px] text-muted-foreground">Parent</Label>
                <Select
                  value={selectedNode.parentId ?? ROOT_PARENT_VALUE}
                  onValueChange={(v) =>
                    reparent(selectedNode.id, v === ROOT_PARENT_VALUE ? null : v)
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={ROOT_PARENT_VALUE}>None (top-level)</SelectItem>
                      {parentOptions
                        .filter((o) => !forbiddenParents.has(o.id))
                        .map((o) => (
                          <SelectItem key={o.id} value={o.id}>
                            {`${"\u00A0\u00A0".repeat(o.depth)}${o.label}`}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label className="text-[11px] text-muted-foreground">Agent</Label>
                <Select
                  value={selectedNode.agentId ?? NO_AGENT_VALUE}
                  onValueChange={(v) => changeAgent(selectedNode, v ?? NO_AGENT_VALUE)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue
                      placeholder={
                        selectedOwner && !selectedOwner.explicit
                          ? `Inherits: ${selectedOwner.name}`
                          : undefined
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={NO_AGENT_VALUE}>None (inherit)</SelectItem>
                      {agents.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  {selectedOwner?.explicit
                    ? `Agent attached to this page.`
                    : `Inherits ${selectedOwner?.name ?? rootAgentName} from a parent page.`}
                </p>
              </div>

              {selectedNode.builtIn ? (
                <p className="text-[10px] text-muted-foreground">
                  Built-in page (cannot be deleted).
                </p>
              ) : (
                <Button
                  variant="destructive"
                  size="sm"
                  className="w-full"
                  onClick={() => handleDelete(selectedNode)}
                >
                  <Trash2Icon data-icon="inline-start" />
                  Delete page
                </Button>
              )}
      </div>
    </FlowInspector>
  );

  const dialog = (
    <StructureCreateDialog
      open={createOpen}
      onOpenChange={setCreateOpen}
      parentOptions={parentOptions}
      initialParentId={createParentId}
      onCreated={handleStructureCreated}
    />
  );

  return (
    <FlowWorkspace
      palette={palette}
      canvas={canvas}
      inspector={inspector}
      extra={dialog}
    />
  );
}

export default function StructureEditor() {
  return (
    <Page className="flex h-[calc(100dvh-7rem)] max-w-none flex-col gap-4">
      <PageHeader
        title="Structure"
        description="Canonical platform structure. The flow chart is the source of truth — drag pages to nest them, attach owner agents, and changes propagate to navigation and the sidebar."
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <StructureEditorChart />
      </div>
    </Page>
  );
}
