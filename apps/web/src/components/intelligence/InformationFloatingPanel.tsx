import {
  ChevronDownIcon,
  ChevronRightIcon,
  CodeIcon,
  InfoIcon,
  LayersIcon,
} from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FloatingWindow } from "@/components/floating/FloatingWindow";
import { useIntelligence } from "@/lib/intelligence-context";
import { useTenant } from "@/lib/tenant-context";
import { useChatUnlock } from "@/lib/chat-unlock-context";
import { useNavigate } from "react-router-dom";
import type { GraphCtaAction, GraphProjectionNode } from "@/api";
import {
  GraphLeaderboardSection,
  GraphNodeMissionsSection,
  GraphScoreboardSection,
} from "@/components/graph/GraphMissionsPanel";
import {
  fetchObjectType,
  type ObjectTypeClient,
} from "@/lib/object-types-api";
import { graphNodeColor } from "@/lib/graph-node-style";

const CodingWorkspacePage = lazy(
  () => import("@/pages/coding/CodingWorkspacePage")
);

type CanvasMode = "overview" | "kernel" | "coding";

function nodeWantsCodingCanvas(node: GraphProjectionNode): boolean {
  const id = node.id.toLowerCase();
  const ref = (node.refId ?? "").toLowerCase();
  const label = node.label.toLowerCase();
  return (
    id.includes("coding") ||
    ref.includes("coding") ||
    label.includes("coding") ||
    node.objectType === "CodingWorkspace"
  );
}

function KernelObjectTypeView({
  objectTypeName,
}: {
  objectTypeName: string | undefined;
}) {
  const navigate = useNavigate();
  const { authenticated } = useTenant();
  const [ot, setOt] = useState<ObjectTypeClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!objectTypeName) {
      setOt(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchObjectType(objectTypeName)
      .then((row) => {
        if (!cancelled) setOt(row);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setOt(null);
          setError(
            err instanceof Error ? err.message : "ObjectType not available"
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [objectTypeName]);

  if (!objectTypeName) {
    return (
      <p className="text-sm text-muted-foreground">
        This Graph node has no ObjectType binding yet.
      </p>
    );
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading kernel type…</p>;
  }

  if (error) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          Kernel type <span className="font-medium text-foreground">{objectTypeName}</span>
          : {error}
        </p>
        {authenticated ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="self-start"
            onClick={() => navigate(`/records/${encodeURIComponent(objectTypeName)}`)}
          >
            Open Records
          </Button>
        ) : null}
      </div>
    );
  }

  if (!ot) return null;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-medium">{ot.label}</p>
        <p className="text-[11px] text-muted-foreground">{ot.name}</p>
        {ot.description ? (
          <p className="mt-1 text-sm text-muted-foreground">{ot.description}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline">
          storage: {ot.storage?.kind ?? "unknown"}
        </Badge>
        {(ot.operations ?? []).map((op) => (
          <Badge key={op} variant="secondary" className="capitalize">
            {op}
          </Badge>
        ))}
      </div>
      {ot.fields.length > 0 ? (
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Fields
          </p>
          <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
            {ot.fields.slice(0, 12).map((f) => (
              <li key={f.name}>
                <span className="text-foreground">{f.label}</span>
                {" · "}
                {f.fieldType}
                {f.required ? " · required" : ""}
              </li>
            ))}
            {ot.fields.length > 12 ? (
              <li>+{ot.fields.length - 12} more</li>
            ) : null}
          </ul>
        </div>
      ) : null}
      {(ot.actions?.length ?? 0) > 0 ? (
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Actions
          </p>
          <div className="flex flex-wrap gap-1.5">
            {ot.actions!.map((a) => (
              <Badge key={a.name} variant="outline">
                {a.label}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}
      {authenticated ? (
        <Button
          type="button"
          size="sm"
          className="self-start"
          onClick={() => navigate(`/records/${encodeURIComponent(ot.name)}`)}
        >
          Open ObjectType Records
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">
          Sign in to browse ObjectType records.
        </p>
      )}
    </div>
  );
}

/**
 * Information window: dynamic canvas (Overview / Kernel / Coding) for Graph nodes.
 */
export function InformationFloatingPanel() {
  const {
    informationPanelOpen,
    informationNode,
    closeInformationPanel,
    openPanel,
    openInformationPanel,
    setPendingChatId,
    setChatTarget,
    composerWidth,
    panelHeight,
  } = useIntelligence();
  const { authenticated } = useTenant();
  const { requestUnlock } = useChatUnlock();
  const navigate = useNavigate();
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [collapsibleIds, setCollapsibleIds] = useState<Set<string>>(
    () => new Set()
  );
  const [canvasMode, setCanvasMode] = useState<CanvasMode>("overview");

  useEffect(() => {
    const onCollapseChanged = (ev: Event) => {
      const detail = (ev as CustomEvent<{
        collapsedIds?: string[];
        collapsibleIds?: string[];
      }>).detail;
      if (Array.isArray(detail?.collapsedIds)) {
        setCollapsedIds(new Set(detail.collapsedIds));
      }
      if (Array.isArray(detail?.collapsibleIds)) {
        setCollapsibleIds(new Set(detail.collapsibleIds));
      }
    };
    window.addEventListener("godmode:graph-collapse-changed", onCollapseChanged);
    return () =>
      window.removeEventListener(
        "godmode:graph-collapse-changed",
        onCollapseChanged
      );
  }, []);

  useEffect(() => {
    if (!informationNode) return;
    setCanvasMode(
      nodeWantsCodingCanvas(informationNode) ? "coding" : "overview"
    );
  }, [informationNode?.id]);

  const runCta = (action: GraphCtaAction, node: GraphProjectionNode) => {
    switch (action.type) {
      case "open_chat":
        if (node.kind === "chat" && node.refId) {
          setPendingChatId(node.refId);
          openPanel({ tab: "chat", maximized: false });
        } else if (node.kind === "agent" && node.refId) {
          setChatTarget({ kind: "agent", agentId: node.refId });
          openPanel({
            tab: "chat",
            agentId: node.refId,
            maximized: false,
          });
        } else {
          openPanel({ tab: "chat", maximized: false });
        }
        openInformationPanel(node);
        return;
      case "open_panel":
        openPanel({
          tab: action.tab as
            | "chat"
            | "notifications"
            | "calendar"
            | "projects"
            | "knowledge"
            | "bank"
            | "vault"
            | "support"
            | "dms"
            | "channels"
            | "contacts",
          maximized: false,
        });
        openInformationPanel(node);
        return;
      case "navigate":
        if (!authenticated && action.path.startsWith("/settings")) {
          navigate("/?auth=1");
          window.dispatchEvent(new CustomEvent("godmode:open-auth"));
          return;
        }
        navigate(action.path);
        openPanel({ maximized: false });
        return;
      case "open_auth":
        if (!authenticated) {
          navigate("/?auth=1");
          window.dispatchEvent(new CustomEvent("godmode:open-auth"));
        } else {
          navigate("/settings");
        }
        return;
      case "open_unlock": {
        const cap =
          action.capability === "chat_create" ? "chat_create" : "chat_window";
        requestUnlock(cap);
        return;
      }
      case "none":
      default:
        return;
    }
  };

  const node = informationNode;
  const accent = node
    ? graphNodeColor(node.kind, node.id, null, node.objectType, node.label)
    : "#a78bfa";
  const statusBits =
    node?.status
      ? Object.entries(node.status)
          .filter(
            ([k]) =>
              !["attention", "attentionCount", "openMissions"].includes(k)
          )
          .map(([k, v]) =>
            typeof v === "boolean" ? `${k}: ${v ? "yes" : "no"}` : `${k}: ${v}`
          )
      : [];

  const titlePrefix =
    canvasMode === "kernel"
      ? "Kernel"
      : canvasMode === "coding"
        ? "Coding"
        : "Information";

  return (
    <FloatingWindow
      open={informationPanelOpen && Boolean(node)}
      title={node ? `${titlePrefix} · ${node.label}` : "Information"}
      icon={
        canvasMode === "coding" ? (
          <CodeIcon className="size-4" style={{ color: accent }} />
        ) : canvasMode === "kernel" ? (
          <LayersIcon className="size-4" style={{ color: accent }} />
        ) : (
          <InfoIcon className="size-4" style={{ color: accent }} />
        )
      }
      accent={accent}
      windowId="information"
      role="information"
      pairGroup="focus-pair"
      placement="focus-right"
      defaultWidth={composerWidth}
      defaultHeight={panelHeight}
      onClose={closeInformationPanel}
    >
      {node ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Tabs
            value={canvasMode}
            onValueChange={(v) => setCanvasMode(v as CanvasMode)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <TabsList
              variant="line"
              className="h-9 w-full shrink-0 justify-start px-2"
            >
              <TabsTrigger value="overview" className="text-xs">
                Overview
              </TabsTrigger>
              <TabsTrigger value="kernel" className="text-xs">
                Kernel
              </TabsTrigger>
              <TabsTrigger value="coding" className="text-xs">
                Coding
              </TabsTrigger>
            </TabsList>

            <TabsContent
              value="overview"
              className="mt-0 min-h-0 flex-1 overflow-y-auto p-4"
            >
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="secondary"
                    className="capitalize"
                    style={{
                      backgroundColor: `${accent}22`,
                      color: accent,
                      borderColor: `${accent}44`,
                    }}
                  >
                    {node.kind}
                  </Badge>
                  {node.status?.attention ? (
                    <Badge variant="destructive">Needs attention</Badge>
                  ) : null}
                  {node.objectType ? (
                    <span className="text-[11px] text-muted-foreground">
                      {node.objectType}
                    </span>
                  ) : null}
                </div>

                <div className="flex flex-col gap-1">
                  <h2 className="text-base font-semibold tracking-tight">
                    {node.label}
                  </h2>
                  <p className="text-sm text-foreground/90">
                    {node.description ??
                      "A piece of the GodMode architecture on The Graph."}
                  </p>
                </div>

                {node.securityNote ? (
                  <div className="rounded-lg border border-border/60 bg-muted/40 p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Security
                    </p>
                    <p className="mt-1 text-sm text-foreground/90">
                      {node.securityNote}
                    </p>
                  </div>
                ) : null}

                {node.connectionLabels && node.connectionLabels.length > 0 ? (
                  <div>
                    <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Connected to
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {node.connectionLabels.map((label) => (
                        <Badge key={label} variant="outline">
                          {label}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}

                {collapsibleIds.has(node.id) ? (
                  <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/30 p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Graph tree
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {collapsedIds.has(node.id)
                        ? "Children are hidden on The Graph. Expand to show this branch."
                        : "Children are visible on The Graph. Collapse to hide this branch."}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="self-start"
                      onClick={() => {
                        window.dispatchEvent(
                          new CustomEvent("godmode:graph-toggle-collapse", {
                            detail: { nodeId: node.id },
                          })
                        );
                      }}
                    >
                      {collapsedIds.has(node.id) ? (
                        <>
                          <ChevronRightIcon data-icon="inline-start" />
                          Expand on Graph
                        </>
                      ) : (
                        <>
                          <ChevronDownIcon data-icon="inline-start" />
                          Collapse on Graph
                        </>
                      )}
                    </Button>
                  </div>
                ) : null}

                {statusBits.length > 0 ? (
                  <div>
                    <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Status
                    </p>
                    <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                      {statusBits.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <GraphNodeMissionsSection
                  nodeId={node.id}
                  onChanged={() => {
                    window.dispatchEvent(
                      new CustomEvent("godmode:graph-missions-changed")
                    );
                  }}
                />

                {node.id === "hub:you" ? (
                  <>
                    <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/30 p-3">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Your identity
                      </p>
                      <div className="flex flex-col gap-1">
                        <p className="text-sm font-medium">Auth / Account</p>
                        <p className="text-sm text-muted-foreground">
                          Sign-in, profile, and membership identity. Auth tokens
                          never appear on The Graph.
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="mt-1 self-start"
                          onClick={() => runCta({ type: "open_auth" }, node)}
                        >
                          {authenticated ? "Open Account" : "Sign in / Sign up"}
                        </Button>
                      </div>
                      <div className="flex flex-col gap-1">
                        <p className="text-sm font-medium">Cloud</p>
                        <p className="text-sm text-muted-foreground">
                          GodMode Cloud membership and plan handle (tenant id
                          only; no secrets on the map).
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="mt-1 self-start"
                          onClick={() =>
                            runCta(
                              { type: "navigate", path: "/settings" },
                              node
                            )
                          }
                        >
                          Open Cloud settings
                        </Button>
                      </div>
                      <div className="flex flex-col gap-1">
                        <p className="text-sm font-medium">LLM keys</p>
                        <p className="text-sm text-muted-foreground">
                          Model provider credentials you own. Values are stored
                          in User Vault. Intelligence and agents use only keys
                          you approve.
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="mt-1 self-start"
                          onClick={() =>
                            runCta({ type: "open_panel", tab: "vault" }, node)
                          }
                        >
                          Open Vault
                        </Button>
                      </div>
                    </div>
                    <GraphScoreboardSection />
                    <GraphLeaderboardSection />
                  </>
                ) : null}

                <div className="mt-auto flex flex-col gap-2 border-t border-border/50 pt-3">
                  {node.cta && node.cta.type !== "none" ? (
                    <Button type="button" onClick={() => runCta(node.cta!, node)}>
                      {node.ctaLabel ?? "Open"}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={closeInformationPanel}
                  >
                    Close
                  </Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent
              value="kernel"
              className="mt-0 min-h-0 flex-1 overflow-y-auto p-4"
            >
              <div className="flex flex-col gap-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  ObjectType kernel
                </p>
                <KernelObjectTypeView objectTypeName={node.objectType} />
              </div>
            </TabsContent>

            <TabsContent
              value="coding"
              className="mt-0 min-h-0 flex-1 overflow-hidden p-2"
            >
              <Suspense
                fallback={
                  <p className="p-2 text-sm text-muted-foreground">
                    Loading Coding canvas…
                  </p>
                }
              >
                <CodingWorkspacePage embedded />
              </Suspense>
            </TabsContent>
          </Tabs>
        </div>
      ) : null}
    </FloatingWindow>
  );
}
