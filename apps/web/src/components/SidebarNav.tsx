import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  BellIcon,
  BookOpenIcon,
  BotIcon,
  BrainIcon,
  CalendarDaysIcon,
  ChevronRightIcon,
  FilePlusIcon,
  LandmarkIcon,
  LayersIcon,
  LifeBuoyIcon,
  ListChecksIcon,
  MessageCircleIcon,
  Share2Icon,
  StoreIcon,
  UsersIcon,
  VaultIcon,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AGENTS_PATH,
  AI_NAME,
  BANK_PATH,
  CALENDAR_PATH,
  CONTACTS_PATH,
  NOTIFICATIONS_PATH,
  VAULT_PATH,
  defaultPathForDivision,
  departmentFromPath,
  divisionFromPath,
  isChromelessPath,
  MARKETPLACE_PATH,
  pageHref,
  SHARED_PATH,
  STRUCTURE_PATH,
  TASKS_PATH,
  USERS_PATH,
  SUPPORT_PATH,
  WIKI_PATH,
} from "@/lib/navigation";
import { useStructure } from "@/lib/structure-context";
import { useTenant } from "@/lib/tenant-context";
import { useIntelligence } from "@/lib/intelligence-context";
import { iconByName } from "@/lib/icon-lookup";
import { cn } from "@/lib/utils";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";
import { AgentGroup } from "@/components/AgentGroup";
import { AgentPulseIcon } from "@/components/AgentPulseIcon";
import {
  fetchAiAgents,
  fetchMarketplaceEntitlements,
  fetchShareGrants,
  type MarketplaceEntitlement,
  type SharedSidebarOwner,
} from "@/api";
import {
  autoChatAgentIdForPagePath,
  userAgentIdForUser,
} from "@/lib/structure-agents";
import { NavBadge } from "@/components/NavBadge";
import { NewUserOnboardingDialog } from "@/components/NewUserOnboardingDialog";
import {
  readOnboardingCompleted,
  writeOnboardingCompleted,
} from "@/lib/storage-keys";

/** The user's personal pages, surfaced at the very top of the nav tree. */
const PERSONAL_ITEMS = [
  { to: NOTIFICATIONS_PATH, label: "Notifications", Icon: BellIcon },
  { to: CALENDAR_PATH, label: "Calendar", Icon: CalendarDaysIcon },
  { to: TASKS_PATH, label: "Tasks", Icon: ListChecksIcon },
  { to: BANK_PATH, label: "Bank", Icon: LandmarkIcon },
  { to: VAULT_PATH, label: "Vault", Icon: VaultIcon },
  { to: SUPPORT_PATH, label: "Support", Icon: LifeBuoyIcon },
] as const;


const NEW_USER_ONBOARDING_PROMPT =
  "I'm new to GodMode. Please read the welcome wiki and platform docs if helpful, then explain how GodMode is organized (departments, agents, Shared, Marketplace). I want to create my first agent — walk me through it and use your tools to set things up with me, not just describe the UI.";

const NEW_AGENT_PROMPT =
  "Help me create a new agent. Ask me what I want it to do and what to call it, then set it up in my workspace.";

const NEW_PAGE_PROMPT =
  "Help me create a new page in my workspace. Ask me what the page is for, then create it and place it under the right team and unit.";

/**
 * Tree navigation. Top: the user's PERSONAL pages (Calendar, Tasks, Vault, etc.).
 * Middle: departments as labeled section headers, each revealing divisions as
 * expandable sub-trees. Bottom: Shared and Marketplace nodes. The active division
 * auto-expands and the active page is highlighted. Users/Settings stay in the
 * footer chrome (see SidebarShellContent.tsx).
 */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { departments, nodes, loading } = useStructure();
  const { user, tenants, activeTenantId } = useTenant();
  const {
    openPanel,
    activeAgentId,
    panelOpen,
    dmUnreadCount,
  } = useIntelligence();

  const userAgentId = user ? userAgentIdForUser(user.id) : null;

  const canEditStructure =
    tenants.find((t) => t.id === activeTenantId)?.role === "owner" ||
    tenants.find((t) => t.id === activeTenantId)?.role === "editor";

  // Resolve agent display names so the "Digital <user>" group can relabel to
  // whichever agent is currently selected in chat.
  const [agentNames, setAgentNames] = useState<Record<string, string>>({});
  useEffect(() => {
    fetchAiAgents()
      .then((r) => {
        const map: Record<string, string> = {};
        for (const a of r.agents) map[a.id] = a.name;
        setAgentNames(map);
      })
      .catch(() => undefined);
  }, []);

  const launchNewUserOnboarding = () => {
    writeOnboardingCompleted(activeTenantId);
    openPanel({
      tab: "chat",
      maximized: true,
      prompt: NEW_USER_ONBOARDING_PROMPT,
      autoSend: true,
    });
    onNavigate?.();
  };

  const [onboardingOpen, setOnboardingOpen] = useState(false);
  useEffect(() => {
    if (loading || readOnboardingCompleted(activeTenantId)) return;
    // FirstRunWizard handles LLM onboarding; skip duplicate welcome dialog.
  }, [loading, departments.length, user, activeTenantId]);

  // Empty-state CTAs: kick off a chat that creates the user's first agent/page.
  // Default to the user's own User Agent (their digital twin); fall back to the
  // Intelligence (Head AI) agent when no user is resolved yet.
  const startCreationChat = (kind: "agent" | "page") => {
    openPanel({
      tab: "chat",
      agentId: userAgentId ?? "intelligence",
      maximized: true,
      prompt: kind === "agent" ? NEW_AGENT_PROMPT : NEW_PAGE_PROMPT,
      autoSend: true,
    });
    onNavigate?.();
  };

  // Label the top group with the signed-in user's name, falling back to the
  // local-part of their email, then a generic "Personal".
  const personalLabel =
    user?.displayName?.trim() || user?.email?.split("@")[0] || "Personal";

  // User group: collapsed by default, auto-expands while on the user's pages
  // (their profile node in the Users chart or the standalone profile page).
  const onUsersPath =
    pathname.startsWith(USERS_PATH) || pathname.startsWith(CONTACTS_PATH);
  const [userGroupOpen, setUserGroupOpen] = useState(onUsersPath);
  useEffect(() => {
    setUserGroupOpen(onUsersPath);
  }, [onUsersPath]);

  const chromeless = isChromelessPath(pathname);
  const activeDepartment = chromeless
    ? undefined
    : departmentFromPath(pathname, departments);
  const activeDivision = chromeless
    ? undefined
    : divisionFromPath(pathname, departments);
  const activeDepartmentId = activeDepartment?.id ?? null;
  const activeKey = activeDivision ? activeDivision.basePath : null;

  const [openKeys, setOpenKeys] = useState<Set<string>>(
    () => new Set(activeKey ? [activeKey] : [])
  );

  // Departments default to collapsed; we track the ones that are open (the
  // active department auto-opens via the effect below).
  const [openDepartments, setOpenDepartments] = useState<Set<string>>(
    () => new Set(activeDepartmentId ? [activeDepartmentId] : [])
  );

  // Keep the active division expanded as the route changes.
  useEffect(() => {
    if (!activeKey) return;
    setOpenKeys((prev) => {
      if (prev.has(activeKey)) return prev;
      const next = new Set(prev);
      next.add(activeKey);
      return next;
    });
  }, [activeKey]);

  // Keep the active department expanded as the route changes.
  useEffect(() => {
    if (!activeDepartmentId) return;
    setOpenDepartments((prev) => {
      if (prev.has(activeDepartmentId)) return prev;
      const next = new Set(prev);
      next.add(activeDepartmentId);
      return next;
    });
  }, [activeDepartmentId]);

  // Shared node: collapsible whose contents are loaded lazily on first expand.
  const [sharedOpen, setSharedOpen] = useState(false);
  const [sharedTree, setSharedTree] = useState<SharedSidebarOwner[]>([]);
  const [sharedLoaded, setSharedLoaded] = useState(false);
  const [sharedLoading, setSharedLoading] = useState(false);

  useEffect(() => {
    if (!sharedOpen || sharedLoaded || sharedLoading) return;
    setSharedLoading(true);
    fetchShareGrants()
      .then((res) => setSharedTree(res.sharedTree ?? []))
      .catch(() => setSharedTree([]))
      .finally(() => {
        setSharedLoaded(true);
        setSharedLoading(false);
      });
  }, [sharedOpen, sharedLoaded, sharedLoading]);

  // Marketplace node: collapsible whose acquired entitlements are loaded
  // lazily on first expand (mirrors the Shared node above).
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);
  const [entitlements, setEntitlements] = useState<MarketplaceEntitlement[]>(
    []
  );
  const [marketplaceLoaded, setMarketplaceLoaded] = useState(false);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);

  useEffect(() => {
    if (!marketplaceOpen || marketplaceLoaded || marketplaceLoading) return;
    setMarketplaceLoading(true);
    fetchMarketplaceEntitlements()
      .then((res) => setEntitlements(res.entitlements))
      .catch(() => setEntitlements([]))
      .finally(() => {
        setMarketplaceLoaded(true);
        setMarketplaceLoading(false);
      });
  }, [marketplaceOpen, marketplaceLoaded, marketplaceLoading]);

  if (loading) {
    return (
      <div className="flex-1 px-2 py-2 text-xs text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <>
      <NewUserOnboardingDialog
        open={onboardingOpen}
        onOpenChange={(open) => {
          setOnboardingOpen(open);
          if (!open) writeOnboardingCompleted(activeTenantId);
        }}
        onStartTour={launchNewUserOnboarding}
      />
    <nav
      aria-label="Primary"
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1"
    >
      <Collapsible
        open={userGroupOpen}
        onOpenChange={setUserGroupOpen}
        className="flex flex-col gap-0.5 rounded-lg border border-sidebar-border/60 bg-sidebar-accent/10 p-1.5"
      >
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              navigate(`${CONTACTS_PATH}?node=self`);
              onNavigate?.();
            }}
            aria-label={`Open ${personalLabel}'s profile`}
            title={`Open ${personalLabel}'s profile`}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-3xl font-bold leading-none tracking-tight transition-colors",
              pathname.startsWith(USERS_PATH) || pathname.startsWith(CONTACTS_PATH)
                ? "text-sidebar-accent-foreground"
                : "text-foreground hover:text-sidebar-accent-foreground"
            )}
          >
            <BrainIcon className="size-6 shrink-0 text-sidebar-accent-foreground" />
            <span className="truncate">{personalLabel}</span>
          </button>
          <CollapsibleTrigger
            aria-label={`Collapse ${personalLabel}`}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-foreground [&[data-state=open]>svg]:rotate-90"
          >
            <ChevronRightIcon className="size-4 transition-transform duration-200" />
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent className="flex flex-col gap-0.5">
          <WorkspaceSwitcher />
          {PERSONAL_ITEMS.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold transition-colors",
                  "hover:bg-sidebar-accent/50",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-foreground"
                )
              }
            >
              <Icon className="size-4 shrink-0" />
              <span className="truncate">{label}</span>
            </NavLink>
          ))}
        </CollapsibleContent>
      </Collapsible>

      {userAgentId && (
        <AgentGroup
          agentId={userAgentId}
          label={`Digital ${personalLabel}`}
          Icon={BotIcon}
          onNavigate={onNavigate}
        />
      )}

      <AgentGroup
        agentId="intelligence"
        label={AI_NAME}
        Icon={BotIcon}
        onNavigate={onNavigate}
      />

      {/* Follows whichever agent is selected in chat, EXCEPT the two fixed
          groups above (the user's Digital twin and the built-in Intelligence),
          which each have their own permanent group. */}
      {activeAgentId !== "intelligence" &&
        activeAgentId !== userAgentId && (
          <AgentGroup
            agentId={activeAgentId}
            label={agentNames[activeAgentId] ?? "Agent"}
            Icon={BotIcon}
            onNavigate={onNavigate}
          />
        )}

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => {
            openPanel({ tab: "chat" });
            onNavigate?.();
          }}
          className={cn(
            "flex items-center gap-2 rounded-lg border border-sidebar-border/60 bg-sidebar-accent/10 px-2 py-2 text-sm font-semibold transition-colors text-left",
            "hover:bg-sidebar-accent/50",
            panelOpen
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-foreground"
          )}
        >
          <MessageCircleIcon className="size-4 shrink-0" />
          <span className="truncate flex-1">Chat</span>
          <NavBadge count={dmUnreadCount} />
        </button>

        <NavLink
          to={AGENTS_PATH}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2 rounded-lg border border-sidebar-border/60 bg-sidebar-accent/10 px-2 py-2 text-sm font-semibold transition-colors",
              "hover:bg-sidebar-accent/50",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-foreground"
            )
          }
        >
          <BotIcon className="size-4 shrink-0" />
          <span className="truncate">Agents</span>
        </NavLink>

        <NavLink
          to={CONTACTS_PATH}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2 rounded-lg border border-sidebar-border/60 bg-sidebar-accent/10 px-2 py-2 text-sm font-semibold transition-colors",
              "hover:bg-sidebar-accent/50",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-foreground"
            )
          }
        >
          <UsersIcon className="size-4 shrink-0" />
          <span className="truncate">Users</span>
        </NavLink>

        <NavLink
          to={WIKI_PATH}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2 rounded-lg border border-sidebar-border/60 bg-sidebar-accent/10 px-2 py-2 text-sm font-semibold transition-colors",
              "hover:bg-sidebar-accent/50",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-foreground"
            )
          }
        >
          <BookOpenIcon className="size-4 shrink-0" />
          <span className="truncate">Wiki</span>
        </NavLink>

        {canEditStructure ? (
          <NavLink
            to={STRUCTURE_PATH}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 rounded-lg border border-sidebar-border/60 bg-sidebar-accent/10 px-2 py-2 text-sm font-semibold transition-colors",
                "hover:bg-sidebar-accent/50",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-foreground"
              )
            }
          >
            <LayersIcon className="size-4 shrink-0" />
            <span className="truncate">Structure</span>
          </NavLink>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
          {departments.length === 0 ? (
            <div className="flex flex-col gap-2 rounded-lg border border-dashed border-sidebar-border/80 bg-sidebar-accent/10 p-3">
              <p className="text-xs leading-relaxed text-muted-foreground">
                Your workspace is empty. Create your first agent or page by
                chatting with{" "}
                <span className="inline-flex items-center gap-0.5 font-medium text-foreground">
                  <BotIcon className="size-3 shrink-0 text-amber-400" />
                  Intelligence
                </span>
                .
              </p>
              <button
                type="button"
                onClick={() => startCreationChat("agent")}
                className="flex items-center gap-2 rounded-md border border-sidebar-border/60 bg-sidebar-accent/20 px-2 py-2 text-sm font-semibold text-foreground transition-colors hover:border-sidebar-accent-foreground/40 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
              >
                <BotIcon className="size-4 shrink-0" />
                <span className="truncate">New Agent</span>
              </button>
              <button
                type="button"
                onClick={() => startCreationChat("page")}
                className="flex items-center gap-2 rounded-md border border-sidebar-border/60 bg-sidebar-accent/20 px-2 py-2 text-sm font-semibold text-foreground transition-colors hover:border-sidebar-accent-foreground/40 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
              >
                <FilePlusIcon className="size-4 shrink-0" />
                <span className="truncate">New Page</span>
              </button>
            </div>
          ) : (
            <>
      {departments.map((department) => {
        const isActiveDepartment = department.id === activeDepartmentId;
        const DeptIcon = iconByName(department.icon);
        const deptOpen = openDepartments.has(department.id);
        return (
          <Collapsible
            key={department.id}
            open={deptOpen}
            onOpenChange={(open) =>
              setOpenDepartments((prev) => {
                const next = new Set(prev);
                if (open) next.add(department.id);
                else next.delete(department.id);
                return next;
              })
            }
            className="flex flex-col gap-0.5 rounded-lg border border-sidebar-border/60 bg-sidebar-accent/10 p-1.5"
          >
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => {
                  setOpenDepartments((prev) =>
                    new Set(prev).add(department.id)
                  );
                  navigate(department.basePath);
                  onNavigate?.();
                }}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 rounded-md border px-2 py-1 text-xs font-semibold uppercase tracking-wide transition-colors",
                  "hover:bg-sidebar-accent/50",
                  isActiveDepartment
                    ? "border-sidebar-accent-foreground/40 bg-sidebar-accent/30 text-sidebar-accent-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <DeptIcon className="size-3.5 shrink-0" />
                <span className="truncate">{department.label}</span>
                {isActiveDepartment && (
                  <span
                    aria-hidden
                    className="ml-auto size-1.5 rounded-full bg-sidebar-accent-foreground"
                  />
                )}
              </button>
              <CollapsibleTrigger
                aria-label={`${deptOpen ? "Collapse" : "Expand"} ${department.label}`}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-foreground"
              >
                <ChevronRightIcon
                  className={cn(
                    "size-3.5 transition-transform duration-200",
                    deptOpen && "rotate-90"
                  )}
                />
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent className="flex flex-col gap-0.5">
            {department.divisions.map((division) => {
              const key = division.basePath;
              const isOpen = openKeys.has(key);
              const isActiveDivision = key === activeKey;
              const DivIcon = iconByName(division.icon);
              return (
                <Collapsible
                  key={key}
                  open={isOpen}
                  onOpenChange={(open) =>
                    setOpenKeys((prev) => {
                      const next = new Set(prev);
                      if (open) next.add(key);
                      else next.delete(key);
                      return next;
                    })
                  }
                >
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setOpenKeys((prev) => new Set(prev).add(key));
                        navigate(defaultPathForDivision(division));
                        onNavigate?.();
                      }}
                      className={cn(
                        "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold transition-colors",
                        "hover:bg-sidebar-accent/50",
                        isActiveDivision
                          ? "text-sidebar-accent-foreground"
                          : "text-foreground"
                      )}
                    >
                      <DivIcon className="size-4 shrink-0" />
                      <span className="truncate">{division.label}</span>
                    </button>
                    <CollapsibleTrigger
                      aria-label={`${isOpen ? "Collapse" : "Expand"} ${division.label}`}
                      className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-foreground"
                    >
                      <ChevronRightIcon
                        className={cn(
                          "size-3.5 transition-transform duration-200",
                          isOpen && "rotate-90"
                        )}
                      />
                    </CollapsibleTrigger>
                  </div>
                  <CollapsibleContent className="flex flex-col gap-0.5 py-0.5 pl-3">
                    {division.pages.map((page) => {
                      const to = pageHref(division, page);
                      const PageIcon = iconByName(page.icon);
                      const pageAgentId = autoChatAgentIdForPagePath(
                        to,
                        nodes,
                        departments
                      );
                      const agentActive =
                        panelOpen && pageAgentId != null && activeAgentId === pageAgentId;

                      if (pageAgentId) {
                        const isActivePage =
                          pathname.replace(/\/+$/, "") === to.replace(/\/+$/, "");
                        return (
                          <button
                            key={page.id}
                            type="button"
                            onClick={() => {
                              openPanel({ agentId: pageAgentId });
                              navigate(to);
                              onNavigate?.();
                            }}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-md border-l border-sidebar-border/50 px-3 py-1.5 text-left text-sm transition-colors",
                              "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                              isActivePage
                                ? "border-sidebar-accent-foreground/60 bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                                : "text-muted-foreground"
                            )}
                          >
                            <AgentPulseIcon pulse active={agentActive}>
                              <PageIcon className="size-4 shrink-0" />
                            </AgentPulseIcon>
                            <span className="truncate">{page.label}</span>
                          </button>
                        );
                      }

                      return (
                        <NavLink
                          key={page.id}
                          to={to}
                          end={page.segment === ""}
                          onClick={onNavigate}
                          className={({ isActive }) =>
                            cn(
                              "flex items-center gap-2 rounded-md border-l border-sidebar-border/50 px-3 py-1.5 text-sm transition-colors",
                              "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                              isActive
                                ? "border-sidebar-accent-foreground/60 bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                                : "text-muted-foreground"
                            )
                          }
                        >
                          <PageIcon className="size-4 shrink-0" />
                          <span className="truncate">{page.label}</span>
                        </NavLink>
                      );
                    })}
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
            </CollapsibleContent>
          </Collapsible>
        );
      })}
            </>
          )}
      </div>

      <Collapsible
        open={sharedOpen}
        onOpenChange={setSharedOpen}
        className="rounded-lg border border-sidebar-border/60 bg-sidebar-accent/10 p-1.5"
      >
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => {
              navigate(SHARED_PATH);
              onNavigate?.();
            }}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold transition-colors",
              "hover:bg-sidebar-accent/50",
              pathname.startsWith(SHARED_PATH)
                ? "text-sidebar-accent-foreground"
                : "text-foreground"
            )}
          >
            <Share2Icon className="size-4 shrink-0" />
            <span className="truncate flex-1">Shared</span>
            <NavBadge
              count={sharedTree.reduce(
                (n, o) =>
                  n +
                  o.departments.reduce((d, dept) => d + dept.divisions.length, 0),
                0
              )}
            />
          </button>
          <CollapsibleTrigger
            aria-label={`${sharedOpen ? "Collapse" : "Expand"} Shared`}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-foreground"
          >
            <ChevronRightIcon
              className={cn(
                "size-3.5 transition-transform duration-200",
                sharedOpen && "rotate-90"
              )}
            />
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent className="flex flex-col gap-1.5 py-0.5 pl-3">
          {sharedLoading && !sharedLoaded ? (
            <p className="px-3 py-1 text-xs text-muted-foreground">Loading…</p>
          ) : sharedTree.length === 0 ? (
            <p className="px-3 py-1 text-xs text-muted-foreground">
              Nothing shared yet
            </p>
          ) : (
            sharedTree.map((owner) => (
              <div key={owner.ownerUserId} className="flex flex-col gap-0.5">
                <div className="px-3 py-0.5 text-xs font-semibold text-foreground">
                  {owner.ownerDisplayName}
                </div>
                {owner.departments.map((dept) => (
                  <div key={`${owner.ownerUserId}-${dept.id}`} className="flex flex-col gap-0.5 pl-2">
                    <div className="px-3 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
                      {dept.label}
                    </div>
                    {dept.divisions.map((div) => (
                      <button
                        key={div.grantId}
                        type="button"
                        onClick={() => {
                          navigate(SHARED_PATH);
                          onNavigate?.();
                        }}
                        className="flex items-center gap-2 rounded-md border-l border-sidebar-border/50 px-3 py-1 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      >
                        <span className="truncate">{div.label}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            ))
          )}
        </CollapsibleContent>
      </Collapsible>

      <Collapsible
        open={marketplaceOpen}
        onOpenChange={setMarketplaceOpen}
        className="rounded-lg border border-sidebar-border/60 bg-sidebar-accent/10 p-1.5"
      >
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => {
              navigate(MARKETPLACE_PATH);
              onNavigate?.();
            }}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold transition-colors",
              "hover:bg-sidebar-accent/50",
              pathname.startsWith(MARKETPLACE_PATH)
                ? "text-sidebar-accent-foreground"
                : "text-foreground"
            )}
          >
            <StoreIcon className="size-4 shrink-0" />
            <span className="truncate flex-1">Marketplace</span>
            <NavBadge count={entitlements.length} />
          </button>
          <CollapsibleTrigger
            aria-label={`${marketplaceOpen ? "Collapse" : "Expand"} Marketplace`}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-foreground"
          >
            <ChevronRightIcon
              className={cn(
                "size-3.5 transition-transform duration-200",
                marketplaceOpen && "rotate-90"
              )}
            />
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent className="flex flex-col gap-0.5 py-0.5 pl-3">
          <NavLink
            to={MARKETPLACE_PATH}
            end
            onClick={onNavigate}
            className="flex items-center gap-2 rounded-md border-l border-sidebar-border/50 px-3 py-1 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <span className="truncate">Browse</span>
          </NavLink>
          {marketplaceLoading && !marketplaceLoaded ? (
            <p className="px-3 py-1 text-xs text-muted-foreground">Loading…</p>
          ) : marketplaceLoaded && entitlements.length === 0 ? (
            <p className="px-3 py-1 text-xs text-muted-foreground">
              Nothing acquired yet
            </p>
          ) : (
            entitlements.map((e) => (
              <NavLink
                key={e.id}
                to={MARKETPLACE_PATH}
                onClick={onNavigate}
                className="flex items-center gap-2 rounded-md border-l border-sidebar-border/50 px-3 py-1 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <span className="truncate">
                  {e.listing_title || e.resource_id}
                </span>
                {e.pricing_model && (
                  <span className="ml-auto shrink-0 text-[0.65rem] uppercase tracking-wide text-muted-foreground/70">
                    {e.pricing_model}
                  </span>
                )}
              </NavLink>
            ))
          )}
        </CollapsibleContent>
      </Collapsible>
    </nav>
    </>
  );
}
