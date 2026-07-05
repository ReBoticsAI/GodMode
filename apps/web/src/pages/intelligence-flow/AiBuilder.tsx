import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  useNodesState,
  useEdgesState,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from "@xyflow/react";
import { FlowCanvas, FlowInspector, FlowWorkspace } from "@/components/flow";
import { LayoutGridIcon, RotateCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useIntelligence } from "@/lib/intelligence-context";
import { useStructure } from "@/lib/structure-context";
import { useTenant } from "@/lib/tenant-context";
import { userAgentIdForUser, isUserAgentId } from "@/lib/structure-agents";
import { useAiStatus } from "@/hooks/use-ai-status";
import {
  fetchAiAgents,
  fetchAiAgent,
  cloneAiAgent,
  deleteAiAgent,
  fetchAiCommands,
  fetchAiInspect,
  fetchAiModels,
  fetchAiPromptFlow,
  fetchAiSettings,
  restartAiModel,
  startAiModel,
  stopAiModel,
  updateAiPromptFlow,
  updateAiSettings,
  updateAiAgent,
  type AiAgent,
  type AiAssembledPrompt,
  type AiInspect,
  type AiModel,
  type AiPromptFlowConfig,
  type AiSettings as AiSettingsType,
} from "@/api";
import { BackendTab } from "@/pages/ai-settings/BackendTab";
import { DelegationTab } from "@/pages/ai-settings/DelegationTab";
import { ModelTab } from "@/pages/ai-settings/ModelTab";
import { GenerationTab } from "@/pages/ai-settings/GenerationTab";
import { CommandsTab } from "@/pages/ai-settings/CommandsTab";
import { ToolsTab } from "@/pages/ai-settings/ToolsTab";
import { ThinkingTab } from "@/pages/ai-settings/ThinkingTab";
import { ToolModeTab } from "@/pages/ai-settings/ToolModeTab";
import { AdaptersTab } from "@/pages/ai-settings/AdaptersTab";
import { TrainingPanel } from "@/pages/ai-settings/TrainingPanel";
import { AgentAccountPanel } from "./AgentAccountPanel";
import { AgentPermissionsPanel } from "./AgentPermissionsPanel";
import { AgentProfilePanel } from "./AgentProfilePanel";
import { PersonaProposalsPanel } from "@/components/PersonaProposalsPanel";
import { AgentTreePalette } from "./AgentTreePalette";
import { KnowledgePanelLink } from "./AgentsSectionLink";
import { filterAgentsToStructure } from "./agent-org";
import { builderNodeTypes } from "./nodes";
import {
  BUILDER_EDGES,
  NODE_DEFS,
  SECTION_KINDS,
  loadPositions,
  savePositions,
  type BuilderNodeData,
  type BuilderNodeKind,
} from "./graph";

const ROOT_AGENT_ID = "intelligence";

export interface AiBuilderProps {
  embedded?: boolean;
  /** Bump to refetch the agent list after external palette mutations. */
  agentsVersion?: number;
}

export function AiBuilder({ embedded = false, agentsVersion = 0 }: AiBuilderProps) {
  const { status, refresh } = useAiStatus();
  const [models, setModels] = useState<AiModel[]>([]);
  const [settings, setSettings] = useState<AiSettingsType | null>(null);
  const [inspect, setInspect] = useState<AiInspect | null>(null);
  const [flowConfig, setFlowConfig] = useState<AiPromptFlowConfig | null>(null);
  const [assembled, setAssembled] = useState<AiAssembledPrompt | null>(null);
  const [commandCount, setCommandCount] = useState(0);
  const [selectedModel, setSelectedModel] = useState("");
  const [promptDraft, setPromptDraft] = useState("");
  const [promptDirty, setPromptDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [allAgents, setAgents] = useState<AiAgent[]>([]);
  const { departments } = useStructure();
  const { user } = useTenant();
  const personaId = user ? userAgentIdForUser(user.id) : null;
  const agents = useMemo(
    () =>
      filterAgentsToStructure(allAgents).filter(
        (a) => !isUserAgentId(a.id) || a.id === personaId
      ),
    [allAgents, departments, personaId]
  );
  const { activeAgentId: selectedAgentId, setActiveAgentId: setSelectedAgentId } =
    useIntelligence();
  const [agentRecord, setAgentRecord] = useState<AiAgent | null>(null);

  const rfRef = useRef<ReactFlowInstance | null>(null);
  const consumedNodeParamRef = useRef<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [searchParams, setSearchParams] = useSearchParams();

  const loadInspect = useCallback(() => {
    fetchAiInspect({ agentId: selectedAgentId })
      .then(setInspect)
      .catch(() => undefined);
  }, [selectedAgentId]);

  const loadFlow = useCallback(() => {
    fetchAiPromptFlow(selectedAgentId)
      .then((r) => {
        setFlowConfig(r.config);
        setAssembled(r.assembled);
      })
      .catch(() => undefined);
  }, [selectedAgentId]);

  useEffect(() => {
    fetchAiModels()
      .then((r) => setModels(r.models))
      .catch(() => setModels([]));
    fetchAiSettings()
      .then((s) => {
        setSettings(s);
        setSelectedModel(s.activeModelPath);
        setPromptDraft(s.systemPrompt);
      })
      .catch(() => undefined);
    fetchAiCommands()
      .then((r) => setCommandCount(r.commands.length))
      .catch(() => undefined);
    loadInspect();
    loadFlow();
    fetchAiAgents()
      .then((r) => setAgents(r.agents))
      .catch(() => setAgents([]));
  }, [loadInspect, loadFlow, agentsVersion]);

  const loadAgent = useCallback((id: string) => {
    fetchAiAgent(id)
      .then((a) => {
        setAgentRecord(a);
        setSettings((prev) =>
          prev
            ? {
                ...prev,
                systemPrompt: a.systemPrompt,
                temperature: a.sampling.temperature,
                topP: a.sampling.topP,
                topK: a.sampling.topK,
                minP: a.sampling.minP,
                repeatPenalty: a.sampling.repeatPenalty,
                presencePenalty: a.sampling.presencePenalty,
                frequencyPenalty: a.sampling.frequencyPenalty,
                maxTokens: a.sampling.maxTokens,
                seed: a.sampling.seed,
                enableThinking: a.thinking.enableThinking,
                thinkingEfficiency: a.thinking.thinkingEfficiency,
                nativeTools: a.thinking.nativeTools,
              }
            : prev
        );
        setPromptDraft(a.systemPrompt);
        setSelectedModel(a.modelPath ?? selectedModel);
      })
      .catch(() => undefined);
  }, [selectedModel]);

  useEffect(() => {
    loadAgent(selectedAgentId);
  }, [selectedAgentId, loadAgent]);

  useEffect(() => {
    if (status?.modelPath && !selectedModel) setSelectedModel(status.modelPath);
  }, [status?.modelPath, selectedModel]);

  const sectionState = useMemo(() => {
    const map = new Map<string, { enabled: boolean; order: number }>();
    flowConfig?.sections.forEach((s) => map.set(s.id, { enabled: s.enabled, order: s.order }));
    return map;
  }, [flowConfig]);

  const assembledMap = useMemo(() => {
    const map = new Map<string, AiAssembledPrompt["sections"][number]>();
    assembled?.sections.forEach((s) => map.set(s.id, s));
    return map;
  }, [assembled]);

  const summaryFor = useCallback(
    (kind: BuilderNodeKind): string => {
      switch (kind) {
        case "model": {
          if (status?.state === "running")
            return `${status.modelName?.replace(/\.gguf$/i, "") ?? "loaded"} · running`;
          if (status?.state === "starting") return "starting…";
          const name = settings?.activeModelPath?.split(/[\\/]/).pop();
          return name ? `${name.replace(/\.gguf$/i, "")} · stopped` : "no model";
        }
        case "generation":
          return settings
            ? `temp ${settings.temperature} · top_p ${settings.topP} · max ${settings.maxTokens}`
            : "—";
        case "thinking":
          return settings?.enableThinking
            ? `on · ${settings.thinkingEfficiency}`
            : "off";
        case "adapters":
          return "LoRA registry";
        case "training":
          return "LoRA training";
        case "toolMode":
          return settings?.nativeTools ? "native API tools" : "text index";
        case "backend":
          return agentRecord ? `${agentRecord.backend} backend` : "—";
        case "delegation":
          return `${agents.length} subagents`;
        case "commands":
          return `${commandCount} slash commands`;
        case "rules":
        case "memory":
        case "skills":
          return "edit in Knowledge";
        case "profile":
          return agentRecord
            ? isUserAgentId(agentRecord.id)
              ? "human profile mirror"
              : "typed agent identity"
            : "—";
        case "user": {
          const knows =
            typeof agentRecord?.config?.knowsUser === "boolean"
              ? agentRecord.config.knowsUser
              : isUserAgentId(selectedAgentId) || selectedAgentId === "intelligence";
          return knows ? "owner user context" : "disabled";
        }
        case "account":
          return "API keys";
        case "permissions":
          return agentRecord?.toolAllow?.length
            ? `${agentRecord.toolAllow.length} tools scoped`
            : "RBAC scope";
        case "final":
          return assembled ? `${assembled.estimatedChars} chars assembled` : "—";
        default: {
          const sec = assembledMap.get(kind);
          if (!sec) return "—";
          if (sec.charCount > 0) return `${sec.charCount} chars`;
          return sec.preview && sec.preview !== "(empty)" ? sec.preview : "empty";
        }
      }
    },
    [
      status,
      settings,
      commandCount,
      assembled,
      assembledMap,
      agentRecord,
      agents.length,
      selectedAgentId,
    ]
  );

  const knowsUser = useMemo(() => {
    if (typeof agentRecord?.config?.knowsUser === "boolean") {
      return agentRecord.config.knowsUser;
    }
    return isUserAgentId(selectedAgentId) || selectedAgentId === "intelligence";
  }, [agentRecord?.config?.knowsUser, selectedAgentId]);

  const autoRespondInGroups = useMemo(
    () => agentRecord?.config?.autoRespondInGroups === true,
    [agentRecord?.config?.autoRespondInGroups]
  );

  const setKnowsUser = (value: boolean) => {
    if (!agentRecord) return;
    saveAgent({
      config: {
        ...(agentRecord.config ?? {}),
        knowsUser: value,
      },
    });
  };

  const setAutoRespondInGroups = (value: boolean) => {
    if (!agentRecord) return;
    saveAgent({
      config: {
        ...(agentRecord.config ?? {}),
        autoRespondInGroups: value,
      },
    });
  };

  const saveAgent = useCallback(
    (patch: Partial<AiAgent> & Record<string, unknown>) => {
      updateAiAgent(selectedAgentId, patch)
        .then((a) => {
          setAgentRecord(a);
          loadAgent(selectedAgentId);
          loadInspect();
          loadFlow();
        })
        .catch(() => undefined);
    },
    [selectedAgentId, loadAgent, loadInspect, loadFlow]
  );

  const rootId = ROOT_AGENT_ID;
  const protectedIds = useMemo(() => {
    const ids = new Set<string>([ROOT_AGENT_ID]);
    if (personaId) ids.add(personaId);
    return ids;
  }, [personaId]);
  const childAgents = useMemo(
    () => agents.filter((a) => a.id !== rootId),
    [agents, rootId]
  );

  const addSubagent = useCallback(() => {
    const name = `Subagent ${childAgents.length + 1}`;
    void cloneAiAgent(ROOT_AGENT_ID, name).then((a) => {
      fetchAiAgents().then((r) => setAgents(r.agents));
      setSelectedAgentId(a.id);
    });
  }, [childAgents.length]);

  const handleDeleteAgent = useCallback(
    (id: string) => {
      if (id === ROOT_AGENT_ID) return;
      void deleteAiAgent(id).then(() => {
        fetchAiAgents().then((r) => setAgents(r.agents));
        if (selectedAgentId === id) setSelectedAgentId(ROOT_AGENT_ID);
      });
    },
    [selectedAgentId, setSelectedAgentId]
  );

  // Rebuild nodes whenever data changes; preserve drag positions and React Flow selection.
  useEffect(() => {
    const positions = loadPositions();
    const builtNodes: Node[] = NODE_DEFS.map((def) => {
      const sec = sectionState.get(def.kind);
      const enabled = def.isSection ? sec?.enabled ?? true : true;
      return {
        id: def.kind,
        type: "builder",
        position: positions[def.kind] ?? def.pos,
        data: {
          kind: def.kind,
          label: def.label,
          summary: summaryFor(def.kind),
          isSection: def.isSection,
          enabled,
          group: def.group,
        } satisfies BuilderNodeData,
      };
    });

    const present = new Set(
      builtNodes
        .filter((n) => {
          const d = n.data as BuilderNodeData;
          return !d.isSection || d.enabled;
        })
        .map((n) => n.id)
    );
    const builtEdges: Edge[] = BUILDER_EDGES.filter(
      ([a, b]) => present.has(a) && present.has(b)
    ).map(([source, target]) => ({
      id: `e-${source}-${target}`,
      source,
      target,
      animated: source === "model" || source === "generation" ? false : true,
    }));

    setNodes((current) =>
      builtNodes.map((built) => {
        const existing = current.find((n) => n.id === built.id);
        return {
          ...built,
          position: existing?.position ?? built.position,
          selected: existing?.selected ?? false,
        };
      })
    );
    setEdges(builtEdges);
  }, [sectionState, summaryFor, setNodes, setEdges]);

  const onNodeDragStop = useCallback(() => {
    const positions = loadPositions();
    for (const n of nodes) positions[n.id] = { x: n.position.x, y: n.position.y };
    savePositions(positions);
  }, [nodes]);

  // Deep-link: a `?node=<kind>` param (e.g. from the sidebar persona button)
  // selects and centers that builder node once, then is consumed so manual
  // selection isn't overridden on later node rebuilds.
  useEffect(() => {
    const nodeParam = searchParams.get("node");
    if (!nodeParam || nodes.length === 0) return;
    if (consumedNodeParamRef.current === nodeParam) return;
    const target = nodes.find((n) => n.id === nodeParam);
    if (!target) return;
    consumedNodeParamRef.current = nodeParam;
    setSelectedId(nodeParam);
    setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === nodeParam })));
    requestAnimationFrame(() =>
      rfRef.current?.setCenter(target.position.x + 90, target.position.y + 30, {
        zoom: 1,
        duration: 300,
      })
    );
    const next = new URLSearchParams(searchParams);
    next.delete("node");
    setSearchParams(next, { replace: true });
  }, [searchParams, nodes, setNodes, setSearchParams]);

  const onTidy = () => {
    const positions: Record<string, { x: number; y: number }> = {};
    NODE_DEFS.forEach((def) => (positions[def.kind] = def.pos));
    savePositions(positions);
    setNodes((nds) =>
      nds.map((n) => {
        const def = NODE_DEFS.find((d) => d.kind === n.id);
        return def ? { ...n, position: def.pos } : n;
      })
    );
    requestAnimationFrame(() => rfRef.current?.fitView({ padding: 0.15 }));
  };

  const wrap = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try {
      await fn();
      refresh();
      loadInspect();
      loadFlow();
    } catch (err) {
      console.error(`${label} failed`, err);
    } finally {
      setBusy(null);
    }
  };

  const saveSetting = (patch: Partial<AiSettingsType>) => {
    const agentFields = [
      "systemPrompt",
      "temperature",
      "topP",
      "topK",
      "minP",
      "repeatPenalty",
      "presencePenalty",
      "frequencyPenalty",
      "maxTokens",
      "seed",
      "enableThinking",
      "thinkingEfficiency",
      "nativeTools",
    ] as const;
    const isAgentField = Object.keys(patch).some((k) =>
      agentFields.includes(k as (typeof agentFields)[number])
    );
    if (isAgentField && selectedAgentId) {
      const agentPatch: Record<string, unknown> = {};
      if (patch.systemPrompt != null) agentPatch.systemPrompt = patch.systemPrompt;
      if (patch.temperature != null || patch.topP != null) {
        agentPatch.sampling = {
          ...(agentRecord?.sampling ?? {}),
          ...(patch.temperature != null ? { temperature: patch.temperature } : {}),
          ...(patch.topP != null ? { topP: patch.topP } : {}),
          ...(patch.topK != null ? { topK: patch.topK } : {}),
          ...(patch.minP != null ? { minP: patch.minP } : {}),
          ...(patch.repeatPenalty != null ? { repeatPenalty: patch.repeatPenalty } : {}),
          ...(patch.presencePenalty != null
            ? { presencePenalty: patch.presencePenalty }
            : {}),
          ...(patch.frequencyPenalty != null
            ? { frequencyPenalty: patch.frequencyPenalty }
            : {}),
          ...(patch.maxTokens != null ? { maxTokens: patch.maxTokens } : {}),
          ...(patch.seed != null ? { seed: patch.seed } : {}),
        };
      }
      if (
        patch.enableThinking != null ||
        patch.thinkingEfficiency != null ||
        patch.nativeTools != null
      ) {
        agentPatch.thinking = {
          ...(agentRecord?.thinking ?? {}),
          ...(patch.enableThinking != null
            ? { enableThinking: patch.enableThinking }
            : {}),
          ...(patch.thinkingEfficiency != null
            ? { thinkingEfficiency: patch.thinkingEfficiency }
            : {}),
          ...(patch.nativeTools != null ? { nativeTools: patch.nativeTools } : {}),
        };
      }
      setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
      if (patch.systemPrompt != null) {
        setPromptDraft(patch.systemPrompt);
        setPromptDirty(false);
      }
      saveAgent(agentPatch);
      return;
    }
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    if (patch.systemPrompt != null) {
      setPromptDraft(patch.systemPrompt);
      setPromptDirty(false);
    }
    updateAiSettings(patch)
      .then((s) => {
        setSettings(s);
        if (patch.systemPrompt != null) setPromptDraft(s.systemPrompt);
      })
      .then(() => {
        loadInspect();
        loadFlow();
      })
      .catch(() => undefined);
  };

  const toggleSection = (kind: BuilderNodeKind, enabled: boolean) => {
    if (!flowConfig) return;
    const exists = flowConfig.sections.some((s) => s.id === kind);
    const sections = exists
      ? flowConfig.sections.map((s) => (s.id === kind ? { ...s, enabled } : s))
      : [
          ...flowConfig.sections,
          {
            id: kind as (typeof SECTION_KINDS)[number],
            enabled,
            order: flowConfig.sections.length,
          },
        ];
    const next = { ...flowConfig, sections };
    setFlowConfig(next);
    updateAiPromptFlow(next, selectedAgentId)
      .then((r) => {
        setFlowConfig(r.config);
        setAssembled(r.assembled);
      })
      .catch(() => undefined);
  };

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;
  const selectedData = selectedNode?.data as BuilderNodeData | undefined;
  const launchLine = inspect?.launch
    ? `${inspect.launch.bin} ${inspect.launch.args.join(" ")}`
    : null;

  const builderNodesFooter = (
    <div className="border-t pt-3">
      <h3 className="text-sm font-semibold">Builder nodes</h3>
      <p className="mb-2 text-xs text-muted-foreground">Click to configure</p>
      <div className="flex flex-col gap-1">
        {NODE_DEFS.map((def) => {
          const enabled = def.isSection
            ? sectionState.get(def.kind)?.enabled ?? true
            : true;
          return (
            <button
              key={def.kind}
              type="button"
              onClick={() => {
                setSelectedId(def.kind);
                setNodes((nds) =>
                  nds.map((n) => ({ ...n, selected: n.id === def.kind }))
                );
                const n = nodes.find((x) => x.id === def.kind);
                if (n)
                  rfRef.current?.setCenter(n.position.x + 90, n.position.y + 30, {
                    zoom: 1,
                    duration: 300,
                  });
              }}
              className={cn(
                "flex items-center justify-between gap-2 rounded-md border bg-card px-2 py-1.5 text-left text-xs",
                selectedId === def.kind
                  ? "border-primary/60 bg-primary/5"
                  : "hover:bg-muted/60",
                def.isSection && !enabled && "opacity-50"
              )}
            >
              <span className="truncate">{def.label}</span>
              {def.isSection && (
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    enabled ? "bg-emerald-500" : "bg-muted-foreground/40"
                  )}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  const paletteEl = (
    <AgentTreePalette
      agents={agents}
      rootId={rootId}
      selectedAgentId={selectedAgentId}
      onSelect={setSelectedAgentId}
      onDelete={handleDeleteAgent}
      onAdd={addSubagent}
      title="Agents"
      protectedIds={protectedIds}
      footer={builderNodesFooter}
    />
  );

  const canvas = (
    <FlowCanvas
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={onNodeDragStop}
      nodeTypes={builderNodeTypes}
      onInit={(inst) => {
        rfRef.current = inst;
      }}
      onNodeClick={(_e, node) => setSelectedId(node.id)}
      onPaneClick={() => setSelectedId(null)}
      fitViewOptions={{ padding: 0.15 }}
      actions={
        <>
          <Button variant="outline" size="sm" onClick={onTidy}>
            <LayoutGridIcon data-icon="inline-start" />
            Tidy
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              loadInspect();
              loadFlow();
            }}
          >
            <RotateCwIcon data-icon="inline-start" />
            Refresh
          </Button>
        </>
      }
    />
  );

  const inspector = !selectedData ? (
    <FlowInspector emptyDescription="Select a node to configure it." />
  ) : (
    <FlowInspector
      title={selectedData.label}
      subtitle={`${selectedData.group}${
        selectedData.isSection && selectedData.kind !== "final"
          ? " · global default"
          : ""
      }`}
      headerAction={
        selectedData.isSection && selectedData.kind !== "final" ? (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">Enabled</span>
            <Switch
              checked={selectedData.enabled}
              onCheckedChange={(v) => toggleSection(selectedData.kind, v)}
            />
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
                {selectedData.kind === "model" && (
                  <ModelTab
                    models={models}
                    settings={settings}
                    status={status}
                    selectedModel={selectedModel}
                    setSelectedModel={setSelectedModel}
                    busy={busy}
                    onStart={() => wrap("start", () => startAiModel(selectedModel || undefined))}
                    onStop={() => wrap("stop", () => stopAiModel())}
                    onRestart={() => wrap("restart", () => restartAiModel(selectedModel || undefined))}
                    saveSetting={saveSetting}
                    launchLine={launchLine}
                  />
                )}
                {selectedData.kind === "generation" && (
                  <GenerationTab
                    settings={settings}
                    inspect={inspect}
                    saveSetting={saveSetting}
                    onRefreshInspect={loadInspect}
                  />
                )}
                {selectedData.kind === "thinking" && (
                  <ThinkingTab settings={settings} saveSetting={saveSetting} />
                )}
                {selectedData.kind === "toolMode" && (
                  <ToolModeTab settings={settings} saveSetting={saveSetting} />
                )}
                {selectedData.kind === "backend" && (
                  <BackendTab agent={agentRecord} saveAgent={saveAgent} />
                )}
                {selectedData.kind === "profile" && agentRecord && (
                  <div className="flex flex-col gap-3">
                    <AgentProfilePanel
                      agent={agentRecord}
                      onSaved={(a) => {
                        setAgentRecord(a);
                        loadFlow();
                      }}
                    />
                    {isUserAgentId(selectedAgentId) && (
                      <PersonaProposalsPanel
                        agentId={selectedAgentId}
                        onApplied={loadFlow}
                      />
                    )}
                    <Label className="text-[11px] text-muted-foreground">Pipeline preview</Label>
                    <pre className="max-h-48 overflow-auto rounded-md border bg-black/30 p-2 font-mono text-[10px] whitespace-pre-wrap">
                      {assembledMap.get("profile")?.preview || "(empty)"}
                    </pre>
                  </div>
                )}
                {selectedData.kind === "user" && agentRecord && (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                      <div>
                        <Label className="text-xs">Knows about me (user context)</Label>
                        <p className="text-[11px] text-muted-foreground">
                          When on, the owner user profile is injected into the prompt.
                        </p>
                      </div>
                      <Switch checked={knowsUser} onCheckedChange={setKnowsUser} />
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                      <div>
                        <Label className="text-xs">Always respond in groups</Label>
                        <p className="text-[11px] text-muted-foreground">
                          When on, replies in group chats without @mention if the message is
                          relevant to this agent&apos;s role (relevance gate).
                        </p>
                      </div>
                      <Switch
                        checked={autoRespondInGroups}
                        onCheckedChange={setAutoRespondInGroups}
                      />
                    </div>
                    <Label className="text-[11px] text-muted-foreground">Pipeline preview</Label>
                    <pre className="max-h-48 overflow-auto rounded-md border bg-black/30 p-2 font-mono text-[10px] whitespace-pre-wrap">
                      {assembledMap.get("user")?.preview || "(empty)"}
                    </pre>
                  </div>
                )}
                {selectedData.kind === "account" && (
                  <AgentAccountPanel agentId={selectedAgentId} />
                )}
                {selectedData.kind === "permissions" && agentRecord && (
                  <AgentPermissionsPanel
                    agent={agentRecord}
                    onSaved={(a) => setAgentRecord(a)}
                  />
                )}
                {selectedData.kind === "delegation" && <DelegationTab />}
                {selectedData.kind === "adapters" && <AdaptersTab />}
                {selectedData.kind === "training" && <TrainingPanel />}
                {selectedData.kind === "base" && (
                  <div className="flex flex-col gap-2">
                    <Label>System prompt (persona)</Label>
                    <p className="text-[11px] text-muted-foreground">
                      Rules, memory, skills, page context, and mentions are
                      appended below this on every request.
                    </p>
                    <Textarea
                      value={promptDraft}
                      onChange={(e) => {
                        setPromptDraft(e.target.value);
                        setPromptDirty(true);
                      }}
                      rows={12}
                      className="font-mono text-xs"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={!promptDirty}
                        onClick={() => saveSetting({ systemPrompt: promptDraft })}
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!inspect || promptDraft === inspect.defaultSystemPrompt}
                        onClick={() => {
                          if (inspect) {
                            setPromptDraft(inspect.defaultSystemPrompt);
                            setPromptDirty(true);
                          }
                        }}
                      >
                        Reset to default
                      </Button>
                    </div>
                  </div>
                )}
                {selectedData.kind === "memory" && (
                  <div className="flex flex-col gap-2">
                    <KnowledgePanelLink label="Memory" />
                    <Label className="text-[11px] text-muted-foreground">Latest preview</Label>
                    <pre className="max-h-64 overflow-auto rounded-md border bg-black/30 p-2 font-mono text-[10px] whitespace-pre-wrap">
                      {assembledMap.get("memory")?.preview || "(empty)"}
                    </pre>
                  </div>
                )}
                {selectedData.kind === "rules" && (
                  <div className="flex flex-col gap-2">
                    <KnowledgePanelLink label="Rules" />
                    <Label className="text-[11px] text-muted-foreground">Latest preview</Label>
                    <pre className="max-h-64 overflow-auto rounded-md border bg-black/30 p-2 font-mono text-[10px] whitespace-pre-wrap">
                      {assembledMap.get("rules")?.preview || "(empty)"}
                    </pre>
                  </div>
                )}
                {selectedData.kind === "skills" && (
                  <div className="flex flex-col gap-2">
                    <KnowledgePanelLink label="Skills" />
                    <Label className="text-[11px] text-muted-foreground">Latest preview</Label>
                    <pre className="max-h-64 overflow-auto rounded-md border bg-black/30 p-2 font-mono text-[10px] whitespace-pre-wrap">
                      {assembledMap.get("skills")?.preview || "(empty)"}
                    </pre>
                  </div>
                )}
                {selectedData.kind === "commands" && <CommandsTab />}
                {selectedData.kind === "tools" && <ToolsTab />}
                {(selectedData.kind === "platform" ||
                  selectedData.kind === "mentions" ||
                  selectedData.kind === "chatHistory" ||
                  selectedData.kind === "userMessage") && (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs text-muted-foreground">
                      {selectedData.kind === "platform" &&
                        "Live page data (breadcrumb, route, structured snapshot) the chat sends automatically."}
                      {selectedData.kind === "mentions" &&
                        "@-mentioned sources attached in the composer for a turn."}
                      {selectedData.kind === "chatHistory" &&
                        "Prior turns sent as separate user/assistant messages."}
                      {selectedData.kind === "userMessage" &&
                        "The current user message and any attached images."}
                    </p>
                    <Label className="text-[11px] text-muted-foreground">Latest preview</Label>
                    <pre className="max-h-64 overflow-auto rounded-md border bg-black/30 p-2 font-mono text-[10px] whitespace-pre-wrap">
                      {assembledMap.get(selectedData.kind)?.preview || "(empty)"}
                    </pre>
                  </div>
                )}
                {selectedData.kind === "final" && (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap gap-1">
                      {assembled?.sections
                        .filter((s) => s.included && s.inSystemPrompt)
                        .map((s) => (
                          <Badge key={s.id} variant="outline" className="text-[10px]">
                            {s.label}
                          </Badge>
                        ))}
                    </div>
                    <Label className="text-[11px] text-muted-foreground">
                      Assembled system prompt ({assembled?.estimatedChars ?? 0} chars)
                    </Label>
                    <pre className="max-h-[60vh] overflow-auto rounded-md border bg-black/30 p-2 font-mono text-[10px] whitespace-pre-wrap">
                      {assembled?.systemPrompt || "(empty)"}
                    </pre>
                  </div>
                )}
      </div>
    </FlowInspector>
  );

  return (
    <FlowWorkspace
      bordered={!embedded}
      palette={paletteEl}
      canvas={canvas}
      inspector={inspector}
    />
  );
}
