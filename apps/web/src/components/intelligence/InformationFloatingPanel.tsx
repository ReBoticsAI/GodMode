import {
  BellIcon,
  BookOpenIcon,
  CalendarIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CodeIcon,
  HashIcon,
  InfoIcon,
  KeyRoundIcon,
  LandmarkIcon,
  LayersIcon,
  LifeBuoyIcon,
  MessageCircleIcon,
  PackageIcon,
  RocketIcon,
  SettingsIcon,
  Share2Icon,
  ShieldCheckIcon,
  ShieldIcon,
  StoreIcon,
  UsersIcon,
  WorkflowIcon,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FloatingWindow } from "@/components/floating/FloatingWindow";
import { useIntelligence, type LeftRailTab } from "@/lib/intelligence-context";
import { useTenant } from "@/lib/tenant-context";
import { useChatUnlock } from "@/lib/chat-unlock-context";
import { useNavigate } from "react-router-dom";
import {
  fetchDmContacts,
  type DmContact,
  type GraphCtaAction,
  type GraphProjectionNode,
} from "@/api";
import { CalendarBoard } from "@/components/intelligence/calendar/CalendarBoard";
import { AutomationsPanel } from "@/pages/Automations";
import { KnowledgePanel } from "@/pages/intelligence-flow/KnowledgePanel";
import Bank from "@/pages/Bank";
import Vault from "@/pages/Vault";
import { PlatformVaultContent } from "@/pages/PlatformVault";
import { AdminContent } from "@/pages/Admin";
import { WikiContent } from "@/pages/Wiki";
import { SupportContent } from "@/pages/Support";
import { SettingsContent } from "@/pages/Settings";
import { SharedContent } from "@/pages/Shared";
import { MarketplaceContent } from "@/pages/Marketplace";
import { StructureContent } from "@/pages/StructureEditor";
import { AgentsContent } from "@/pages/Agents";
import { UsersContent } from "@/pages/Users";
import { ContactsContent } from "@/pages/ContactsFlow";
import { ReleasesContent } from "@/pages/ReleaseSubmissionsPage";
import { TasksContent } from "@/pages/UserTasks";
import { ConversationList } from "@/components/messages/ConversationList";
import { NotificationsList } from "@/components/NotificationsList";
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
import { floatingSurfaceForTab } from "@/lib/graph-floating-surfaces";

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
    informationPanelMinimized,
    setInformationPanelMinimized,
    informationNode,
    closeInformationPanel,
    openPanel,
    activeLeftTab,
    setActiveLeftTab,
    activeAgentId,
    chatTarget,
    setChatTarget,
    dmConversations,
    refreshDmConversations,
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

  const [dmContacts, setDmContacts] = useState<DmContact[]>([]);
  useEffect(() => {
    fetchDmContacts()
      .then((c) => setDmContacts(c.contacts))
      .catch(() => undefined);
  }, []);

  const directConversations = useMemo(
    () => dmConversations.filter((c) => c.kind !== "group"),
    [dmConversations]
  );
  const groupConversations = useMemo(
    () => dmConversations.filter((c) => c.kind === "group"),
    [dmConversations]
  );
  const activeConversationId =
    chatTarget.kind === "conversation" ? chatTarget.conversationId : null;

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
          setChatTarget({ kind: "agent", agentId: node.refId });
        } else if (node.kind === "agent" && node.refId) {
          setChatTarget({ kind: "agent", agentId: node.refId });
        }
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("godmode:show-chat"));
        }
        return;
      case "open_panel": {
        const surface = floatingSurfaceForTab(action.tab);
        if (surface) {
          window.dispatchEvent(
            new CustomEvent(surface.event, { detail: {} })
          );
          return;
        }
        if (action.tab) {
          setActiveLeftTab(action.tab as LeftRailTab);
        }
        return;
      }
      case "navigate":
        if (!authenticated && action.path.startsWith("/settings")) {
          navigate("/?auth=1");
          window.dispatchEvent(new CustomEvent("godmode:open-auth"));
          return;
        }
        {
          const surfaceMatch = [
            floatingSurfaceForTab("platform-vault"),
            floatingSurfaceForTab("admin"),
            floatingSurfaceForTab("wiki"),
            floatingSurfaceForTab("personal-vault"),
            floatingSurfaceForTab("settings"),
            floatingSurfaceForTab("shared"),
            floatingSurfaceForTab("marketplace"),
            floatingSurfaceForTab("structure"),
            floatingSurfaceForTab("coding"),
            floatingSurfaceForTab("releases"),
            floatingSurfaceForTab("agents"),
            floatingSurfaceForTab("users"),
            floatingSurfaceForTab("support"),
            floatingSurfaceForTab("tasks"),
            floatingSurfaceForTab("contacts"),
          ].find(
            (s) =>
              s &&
              (action.path === s.path || action.path.startsWith(`${s.path}?`))
          );
          if (surfaceMatch) {
            const q = action.path.includes("?")
              ? new URLSearchParams(action.path.split("?")[1])
              : null;
            window.dispatchEvent(
              new CustomEvent(surfaceMatch.event, {
                detail: {
                  vault: q?.get("vault"),
                  sub: q?.get("sub"),
                  tab: q?.get("tab"),
                },
              })
            );
            return;
          }
        }
        navigate(action.path);
        openPanel({ maximized: false });
        return;
      case "open_auth":
        if (!authenticated) {
          navigate("/?auth=1");
          window.dispatchEvent(new CustomEvent("godmode:open-auth"));
        } else {
          window.dispatchEvent(
            new CustomEvent("godmode:open-settings", { detail: {} })
          );
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

  let panelTitle = "Information";
  let panelIcon: ReactNode = (
    <InfoIcon className="size-4" style={{ color: accent }} />
  );
  let panelAccent = accent;

  if (activeLeftTab === "calendar") {
    panelTitle = "Calendar";
    panelAccent = "#38bdf8";
    panelIcon = (
      <CalendarIcon className="size-4" style={{ color: panelAccent }} />
    );
  } else if (activeLeftTab === "projects") {
    panelTitle = "Automations";
    panelAccent = "#a78bfa";
    panelIcon = (
      <WorkflowIcon className="size-4" style={{ color: panelAccent }} />
    );
  } else if (activeLeftTab === "knowledge") {
    panelTitle = "Knowledge";
    panelAccent = "#34d399";
    panelIcon = (
      <BookOpenIcon className="size-4" style={{ color: panelAccent }} />
    );
  } else if (activeLeftTab === "bank") {
    panelTitle = "Bank";
    panelAccent = "#fbbf24";
    panelIcon = (
      <LandmarkIcon className="size-4" style={{ color: panelAccent }} />
    );
  } else if (activeLeftTab === "vault") {
    panelTitle = "Agent Vault";
    panelAccent = "#f87171";
    panelIcon = (
      <ShieldCheckIcon className="size-4" style={{ color: panelAccent }} />
    );
  } else if (activeLeftTab === "platform-vault") {
    panelTitle = "Platform Vault";
    panelAccent = "#fbbf24";
    panelIcon = (
      <KeyRoundIcon className="size-4" style={{ color: panelAccent }} />
    );
  } else if (activeLeftTab === "personal-vault") {
    panelTitle = "Personal Vault";
    panelAccent = "#f87171";
    panelIcon = (
      <ShieldCheckIcon className="size-4" style={{ color: panelAccent }} />
    );
  } else if (activeLeftTab === "admin") {
    panelTitle = "Admin";
    panelAccent = "#a78bfa";
    panelIcon = (
      <ShieldIcon className="size-4" style={{ color: panelAccent }} />
    );
  } else if (activeLeftTab === "wiki") {
    panelTitle = "Wiki";
    panelAccent = "#34d399";
    panelIcon = (
      <BookOpenIcon className="size-4" style={{ color: panelAccent }} />
    );
  } else if (activeLeftTab === "support") {
    panelTitle = "Support";
    panelAccent = "#818cf8";
    panelIcon = (
      <LifeBuoyIcon className="size-4" style={{ color: panelAccent }} />
    );
  } else if (activeLeftTab === "settings") {
    panelTitle = "Settings";
    panelAccent = "#94a3b8";
    panelIcon = (
      <SettingsIcon className="size-4" style={{ color: panelAccent }} />
    );
  } else if (activeLeftTab === "shared") {
    panelTitle = "Shared";
    panelAccent = "#818cf8";
    panelIcon = (
      <Share2Icon className="size-4" style={{ color: panelAccent }} />
    );
  } else if (activeLeftTab === "marketplace") {
    panelTitle = "Marketplace";
    panelAccent = "#fb923c";
    panelIcon = (
      <StoreIcon className="size-4" style={{ color: panelAccent }} />
    );
  } else if (activeLeftTab === "structure") {
    panelTitle = "Structure";
    panelAccent = "#60a5fa";
    panelIcon = (
      <LayersIcon className="size-4" style={{ color: panelAccent }} />
    );
  } else if (activeLeftTab === "coding") {
    panelTitle = "Coding";
    panelAccent = "#38bdf8";
    panelIcon = (
      <CodeIcon className="size-4" style={{ color: panelAccent }} />
    );
  } else if (activeLeftTab === "releases") {
    panelTitle = "Releases";
    panelAccent = "#f472b6";
    panelIcon = (
      <RocketIcon className="size-4" style={{ color: panelAccent }} />
    );
  } else if (activeLeftTab === "agents") {
    panelTitle = "Agents";
    panelAccent = "#a78bfa";
    panelIcon = (
      <WorkflowIcon className="size-4" style={{ color: panelAccent }} />
    );
  } else if (activeLeftTab === "users") {
    panelTitle = "Profile";
    panelAccent = "#34d399";
    panelIcon = <UsersIcon className="size-4" style={{ color: panelAccent }} />;
  } else if (activeLeftTab === "tasks") {
    panelTitle = "Tasks";
    panelAccent = "#a78bfa";
    panelIcon = (
      <PackageIcon className="size-4" style={{ color: panelAccent }} />
    );
  } else if (activeLeftTab === "notifications") {
    panelTitle = "Notifications";
    panelAccent = "#fb923c";
    panelIcon = <BellIcon className="size-4" style={{ color: panelAccent }} />;
  } else if (activeLeftTab === "contacts") {
    panelTitle = "Contacts";
    panelAccent = "#38bdf8";
    panelIcon = <UsersIcon className="size-4" style={{ color: panelAccent }} />;
  } else if (activeLeftTab === "dms") {
    panelTitle = "Direct Messages";
    panelAccent = "#38bdf8";
    panelIcon = (
      <MessageCircleIcon className="size-4" style={{ color: panelAccent }} />
    );
  } else if (activeLeftTab === "channels") {
    panelTitle = "Channels";
    panelAccent = "#38bdf8";
    panelIcon = <HashIcon className="size-4" style={{ color: panelAccent }} />;
  } else if (node) {
    panelTitle = `${titlePrefix} · ${node.label}`;
    panelIcon =
      canvasMode === "coding" ? (
        <CodeIcon className="size-4" style={{ color: accent }} />
      ) : canvasMode === "kernel" ? (
        <LayersIcon className="size-4" style={{ color: accent }} />
      ) : (
        <InfoIcon className="size-4" style={{ color: accent }} />
      );
  }

  return (
    <FloatingWindow
      open={informationPanelOpen && (activeLeftTab !== "info" || Boolean(node))}
      minimized={informationPanelMinimized}
      onMinimize={() => setInformationPanelMinimized(true)}
      title={panelTitle}
      icon={panelIcon}
      accent={panelAccent}
      windowId="information"
      role="information"
      pairGroup="focus-pair"
      placement="left"
      defaultWidth={composerWidth}
      defaultHeight={panelHeight}
      onClose={closeInformationPanel}
    >
      {activeLeftTab === "calendar" ? (
        <div className="min-h-0 flex-1 overflow-hidden px-2 py-2">
          <CalendarBoard scope={{ kind: "agent", agentId: activeAgentId }} />
        </div>
      ) : activeLeftTab === "projects" ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <AutomationsPanel agentId={activeAgentId} showTasks showEvents />
        </div>
      ) : activeLeftTab === "knowledge" ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <KnowledgePanel />
        </div>
      ) : activeLeftTab === "bank" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          <Bank embedded agentId={activeAgentId} />
        </div>
      ) : activeLeftTab === "vault" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          <Vault mode="agent" agentId={activeAgentId} embedded />
        </div>
      ) : activeLeftTab === "personal-vault" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          <Vault mode="user" embedded />
        </div>
      ) : activeLeftTab === "platform-vault" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          <PlatformVaultContent embedded />
        </div>
      ) : activeLeftTab === "admin" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          <AdminContent embedded />
        </div>
      ) : activeLeftTab === "wiki" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          <WikiContent embedded />
        </div>
      ) : activeLeftTab === "support" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          <SupportContent embedded />
        </div>
      ) : activeLeftTab === "settings" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          <SettingsContent embedded />
        </div>
      ) : activeLeftTab === "shared" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          <SharedContent embedded />
        </div>
      ) : activeLeftTab === "marketplace" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          <MarketplaceContent embedded />
        </div>
      ) : activeLeftTab === "structure" ? (
        <div className="min-h-0 flex-1 overflow-hidden px-1 py-1">
          <StructureContent />
        </div>
      ) : activeLeftTab === "coding" ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <Suspense
            fallback={
              <p className="p-3 text-sm text-muted-foreground">Loading coding…</p>
            }
          >
            <CodingWorkspacePage embedded />
          </Suspense>
        </div>
      ) : activeLeftTab === "releases" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          <ReleasesContent embedded />
        </div>
      ) : activeLeftTab === "agents" ? (
        <div className="min-h-0 flex-1 overflow-hidden px-1 py-1">
          <AgentsContent />
        </div>
      ) : activeLeftTab === "users" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          <UsersContent />
        </div>
      ) : activeLeftTab === "tasks" ? (
        <div className="min-h-0 flex-1 overflow-hidden px-1 py-1">
          <TasksContent embedded />
        </div>
      ) : activeLeftTab === "notifications" ? (
        <div className="min-h-0 flex-1 overflow-hidden px-3 py-2">
          <NotificationsList compact />
        </div>
      ) : activeLeftTab === "contacts" ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <ContactsContent />
        </div>
      ) : activeLeftTab === "dms" ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <ConversationList
            conversations={directConversations}
            contacts={dmContacts}
            activeId={activeConversationId}
            onSelect={(id: string) => {
              setChatTarget({ kind: "conversation", conversationId: id });
              if (typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent("godmode:show-chat"));
              }
            }}
            onCreated={() => void refreshDmConversations()}
          />
        </div>
      ) : activeLeftTab === "channels" ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <ConversationList
            conversations={groupConversations}
            contacts={dmContacts}
            activeId={activeConversationId}
            onSelect={(id: string) => {
              setChatTarget({ kind: "conversation", conversationId: id });
              if (typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent("godmode:show-chat"));
              }
            }}
            onCreated={() => void refreshDmConversations()}
          />
        </div>
      ) : node ? (
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
                  {node.status?.working ? (
                    <Badge variant="secondary">In progress</Badge>
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
                              { type: "open_panel", tab: "platform-vault" },
                              node
                            )
                          }
                        >
                          Open Platform Vault · Cloud
                        </Button>
                      </div>
                      <div className="flex flex-col gap-1">
                        <p className="text-sm font-medium">LLM keys</p>
                        <p className="text-sm text-muted-foreground">
                          Model provider credentials you own. Values are stored
                          in Platform Vault. Intelligence and agents use only
                          keys you approve.
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="mt-1 self-start"
                          onClick={() =>
                            runCta(
                              { type: "open_panel", tab: "platform-vault" },
                              node
                            )
                          }
                        >
                          Open Platform Vault
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
