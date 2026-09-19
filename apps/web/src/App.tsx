import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import Home from "./pages/Home";
import AgentsPage from "./pages/Agents";
import Admin from "./pages/Admin";
import Settings from "./pages/Settings";
import PlatformVault from "./pages/PlatformVault";
import Vault from "./pages/Vault";
import Users from "./pages/Users";
import Shared from "./pages/Shared";
import AuthGate from "./pages/AuthGate";
import MarketingRoutes from "./pages/marketing/MarketingRoutes";
import {
  MARKETING_BASE,
  marketingAtRoot,
} from "./pages/marketing/marketingBase";
import { FirstRunWizard, OnboardingWizardProvider, useOnboardingGate } from "@/components/FirstRunWizard";
import { NoWorkspaceGate } from "@/components/NoWorkspaceGate";
import { PreAuthChatCanvas } from "@/components/PreAuthChatCanvas";
import { ChatUnlockProvider } from "@/lib/chat-unlock-context";
import { ChatGraphCanvas } from "@/components/ChatGraphCanvas";
import Bank from "./pages/Bank";
import DepartmentOverview from "./pages/DepartmentOverview";
import UserCalendarPage from "./pages/UserCalendar";
import UserTasksPage from "./pages/UserTasks";
import Notifications from "./pages/Notifications";
import Support from "./pages/Support";
import Wiki from "./pages/Wiki";
import WikiPage from "./pages/WikiPage";
import CodingWorkspacePage from "./pages/coding/CodingWorkspacePage";
import ReleaseSubmissionsPage from "./pages/ReleaseSubmissionsPage";
import RecordListPage from "./pages/records/RecordListPage";
import RecordFormPage from "./pages/records/RecordFormPage";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { AppHeader } from "@/components/AppHeader";
import { AppFooter } from "@/components/AppFooter";
import {
  HOLDINGS_PATH,
  HOME_PATH,
  BANK_PATH,
  AGENTS_PATH,
  ADMIN_PATH,
  CALENDAR_PATH,
  TASKS_PATH,
  NOTIFICATIONS_PATH,
  SUPPORT_PATH,
  WIKI_PATH,
  CODING_PATH,
  RELEASES_PATH,
  RECORDS_PATH,
  MARKETPLACE_PATH,
  CONTACTS_PATH,
  SHARED_PATH,
  SETTINGS_PATH,
  PLATFORM_VAULT_PATH,
  USERS_PATH,
  VAULT_PATH,
  STRUCTURE_PATH,
  STRUCTURE_SETTINGS_PATH,
  divisionFromPath,
  isChromelessPath,
  type DepartmentNode,
  type DivisionNode,
} from "@/lib/navigation";
import {
  StructureProvider,
  useStructure,
} from "@/lib/structure-context";
import { TenantProvider, useTenant } from "@/lib/tenant-context";
import { IntelligenceProvider, useIntelligence } from "@/lib/intelligence-context";
import { PageChromeProvider } from "@/lib/page-chrome-context";
import Marketplace from "./pages/Marketplace";
import SellerLinkConnectPage, {
  SELLER_LINK_STATE_KEY,
} from "./pages/SellerLinkConnect";
import SellerLinkGithubPage, {
  SELLER_GITHUB_STATE_KEY,
} from "./pages/SellerLinkGithub";
import SellerLinkStripePage, {
  SELLER_STRIPE_STATE_KEY,
} from "./pages/SellerLinkStripe";
import StructureEditor from "./pages/StructureEditor";
import ContactsFlow from "./pages/ContactsFlow";
import { IntelligencePanel } from "@/components/intelligence/IntelligencePanel";
import { InformationFloatingPanel } from "@/components/intelligence/InformationFloatingPanel";
import { MinimizedWindowsDock } from "@/components/floating/MinimizedWindowsDock";
import { GraphEscMenu } from "@/components/graph/GraphEscMenu";
import { pageElementFor } from "@/lib/page-registry";
import { loadWebPlugins } from "@/plugins/loader";
import { webPluginRuntime } from "@/plugins/runtime";
import { useIsMobile } from "@/hooks/use-mobile";
import { useEffect, useMemo, useState, useRef, createElement, type ComponentType } from "react";
import { autoChatAgentIdForPagePath } from "@/lib/structure-agents";
import { floatingSurfaceForPath, isGraphFloatingIndexPath } from "@/lib/graph-floating-surfaces";
import { toast } from "sonner";
import { connectWebSocket, fetchBridgeHealth, ensureTrialInference } from "@/api";
import { useChatUnlock } from "@/lib/chat-unlock-context";

interface AiNotificationPayload {
  kind?: string;
  runId?: string;
  cardId?: string;
  cardTitle?: string;
  message?: string;
}

/** Surfaces autonomous-runner review/failure notifications as toasts + a badge. */
function AiNotifications() {
  const { setPanelTab, setPanelOpen, bumpReviewUnread } = useIntelligence();
  useEffect(() => {
    return connectWebSocket((raw) => {
      const msg = raw as { type?: string; data?: AiNotificationPayload };
      if (msg?.type !== "ai_notification") return;
      const data = msg.data ?? {};
      const label = data.cardTitle ? `${data.message} — ${data.cardTitle}` : data.message ?? "Review requested";
      if (data.kind === "run_failed") {
        toast.error(label);
        return;
      }
      bumpReviewUnread();
      toast(label, {
        action: {
          label: "Review",
          onClick: () => {
            setPanelTab("projects");
            setPanelOpen(true);
          },
        },
      });
    });
  }, [setPanelTab, setPanelOpen, bumpReviewUnread]);
  return null;
}

/**
 * Authenticated land: The Graph is primary. Trial ensure (#758) runs in background.
 * Re-runs when the active workspace changes so Vault attach / model select can
 * recover on a fresh tenant DB (see ensureWorkspaceHasTrialKey).
 * Chat opens when the user clicks Chat or Intelligence on the canvas.
 */
function FirstLandChatBootstrap() {
  const { loading } = useChatUnlock();
  const { user, authenticated, activeTenantId } = useTenant();
  const lastEnsureKey = useRef<string | null>(null);

  useEffect(() => {
    if (loading || !authenticated || !user) return;
    const key = `${user.id}:${activeTenantId ?? ""}`;
    if (lastEnsureKey.current === key) return;
    lastEnsureKey.current = key;
    void ensureTrialInference({
      email: user.email,
      displayName: user.displayName,
    }).catch(() => {
      /* soft-fail: Vault Connect / FirstRunWizard remain */
    });
  }, [loading, authenticated, user, activeTenantId]);

  return null;
}

const AI_SETTINGS_PATH = "/settings/ai";

function AppShell() {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const { departments, nodes, loading } = useStructure();
  const { openPanel, panelOpen } = useIntelligence();
  const isMobile = useIsMobile();

  // Auto-open chat with page-bound agents only on divisions that use the price sidebar.
  const autoChatAgentId = useMemo(
    () =>
      loading ? null : autoChatAgentIdForPagePath(pathname, nodes, departments),
    [loading, pathname, nodes, departments]
  );
  useEffect(() => {
    if (!autoChatAgentId) return;
    openPanel({ agentId: autoChatAgentId });
  }, [autoChatAgentId, pathname, openPanel]);

  // Deep-link chrome index routes → Graph home + floating window.
  useEffect(() => {
    const surface = floatingSurfaceForPath(pathname);
    if (!surface) return;
    const detail: Record<string, string | null> = {};
    if (surface.tab === "platform-vault") {
      detail.vault = searchParams.get("vault");
      detail.sub = searchParams.get("sub");
    } else if (surface.tab === "admin" || surface.tab === "settings") {
      detail.tab = searchParams.get("tab");
    }
    window.dispatchEvent(
      new CustomEvent(surface.event, { detail })
    );
  }, [pathname, searchParams]);

  const [rightOpen, setRightOpen] = useState(false);

  const chromeless = isChromelessPath(pathname);
  const division = chromeless
    ? undefined
    : divisionFromPath(pathname, departments);
  const hasRightPanel = Boolean(
    !chromeless &&
      division?.rightSidebar &&
      webPluginRuntime.shellForSidebar(division.rightSidebar)
  );
  const RightSidebarComp =
    division?.rightSidebar != null
      ? webPluginRuntime.shellForSidebar(division.rightSidebar)
      : null;

  // Graph is the primary surface on Home. Chrome index deep-links open
  // floating windows over the Graph (Settings, Vaults, Wiki index, …).
  // Detail routes (e.g. /wiki/:slug) still paint in main.
  const onGraphHome = pathname === HOME_PATH || pathname === "/";
  const onFloatingIndex = isGraphFloatingIndexPath(pathname);
  const showAppRoutes =
    (panelOpen || !onGraphHome) && !onFloatingIndex;

  // Close the plugin drawer whenever the route changes.
  useEffect(() => {
    setRightOpen(false);
  }, [pathname]);

  // Plugin drawer only exists in compact mode; clear when growing to desktop.
  useEffect(() => {
    if (!isMobile) {
      setRightOpen(false);
    }
  }, [isMobile]);

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <ChatGraphCanvas />
        <AppHeader
          onOpenRightPanel={
            hasRightPanel ? () => setRightOpen(true) : undefined
          }
          rightPanelKind={hasRightPanel ? division?.rightSidebar ?? undefined : undefined}
        />
        <main
          className={
            showAppRoutes
              ? panelOpen
                ? "relative z-10 min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-background/90"
                : "relative z-10 min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-background"
              : "pointer-events-none invisible relative z-10 min-h-0 flex-1 overflow-hidden"
          }
          aria-hidden={!showAppRoutes}
        >
          <AppRoutes departments={departments} loading={loading} />
        </main>
        <IntelligencePanel />
        <InformationFloatingPanel />
        <MinimizedWindowsDock />
        <AppFooter />
      </div>

      {/* Right panel: static rail on desktop, drawer in compact mode */}
      {hasRightPanel && !isMobile && RightSidebarComp && (
        <RightSidebarComp />
      )}
      {hasRightPanel && isMobile && RightSidebarComp && (
        <Sheet open={rightOpen} onOpenChange={setRightOpen}>
          <SheetContent
            side="right"
            className="w-[92vw] max-w-md gap-0 bg-sidebar p-0 text-sidebar-foreground"
          >
            <SheetTitle className="sr-only">Side panel</SheetTitle>
            <div className="flex h-full w-full flex-col overflow-hidden">
              {RightSidebarComp &&
                createElement(RightSidebarComp as ComponentType<{ variant?: "panel" }>, {
                  variant: "panel",
                })}
            </div>
          </SheetContent>
        </Sheet>
      )}

      <FirstLandChatBootstrap />
      <AiNotifications />
      <GraphEscMenu />
      <Toaster richColors position="top-right" />
    </div>
  );
}

function AppRoutes({
  departments,
  loading,
}: {
  departments: DepartmentNode[];
  loading: boolean;
}) {
  const fallback = HOME_PATH;
  return (
    <Routes>
      <Route path={SETTINGS_PATH} element={<Settings />} />
      <Route path={PLATFORM_VAULT_PATH} element={<PlatformVault />} />
      <Route path={ADMIN_PATH} element={<Admin />} />
      <Route path={USERS_PATH} element={<Users />} />
      <Route path={VAULT_PATH} element={<Vault />} />
      <Route path={SHARED_PATH} element={<Shared />} />
      <Route path={STRUCTURE_SETTINGS_PATH} element={<Navigate to={STRUCTURE_PATH} replace />} />
      {/* /settings/ai retired — AI config now lives in the Intelligence chat panel. */}
      <Route path={AI_SETTINGS_PATH} element={<Navigate to={fallback} replace />} />
      <Route path={HOME_PATH} element={<Home />} />
      <Route path={AGENTS_PATH} element={<AgentsPage />} />
      <Route path={BANK_PATH} element={<Bank />} />
      <Route path={HOLDINGS_PATH} element={<Navigate to={BANK_PATH} replace />} />
      <Route path={CALENDAR_PATH} element={<UserCalendarPage />} />
      <Route path={TASKS_PATH} element={<UserTasksPage />} />
      <Route path={NOTIFICATIONS_PATH} element={<Notifications />} />
      <Route path={SUPPORT_PATH} element={<Support />} />
      <Route path={WIKI_PATH} element={<Wiki />} />
      <Route path={`${WIKI_PATH}/:slug`} element={<WikiPage />} />
      <Route path={CODING_PATH} element={<CodingWorkspacePage />} />
      <Route path={RELEASES_PATH} element={<ReleaseSubmissionsPage />} />
      <Route path={RECORDS_PATH} element={<RecordListPage objectType="StructureNode" />} />
      <Route path={`${RECORDS_PATH}/:objectType`} element={<RecordListPage />} />
      <Route
        path={`${RECORDS_PATH}/:objectType/:recordId`}
        element={<RecordFormPage />}
      />
      <Route path={STRUCTURE_PATH} element={<StructureEditor />} />
      <Route path={CONTACTS_PATH} element={<ContactsFlow />} />
      <Route path={MARKETPLACE_PATH} element={<Marketplace />} />

      {departments.flatMap((dept) => buildDepartmentRoutes(dept))}

      <Route path="/" element={<Navigate to={fallback} replace />} />

      {webPluginRuntime.allRoutes().map((r) => (
        <Route key={r.path} path={r.path} element={r.element} />
      ))}
      {webPluginRuntime.allRedirects().map((r) => (
        <Route
          key={r.from}
          path={r.from}
          element={<Navigate to={r.to} replace />}
        />
      ))}
      <Route path="/builder/:id" element={<Navigate to="/" replace />} />

      <Route
        path="*"
        element={loading ? null : <Navigate to={fallback} replace />}
      />
    </Routes>
  );
}

function buildDepartmentRoutes(department: DepartmentNode) {
  const trimmed = department.basePath.replace(/^\//, "");
  const deptBase = department.basePath.replace(/\/$/, "");
  const children = department.divisions.flatMap((div) =>
    buildDivisionRoutes(department, div)
  );

  // A division whose base path equals the department's already renders at the
  // index slot (e.g. brick-and-mortar/overview). Only fall back to the generic
  // department overview when that index isn't otherwise occupied.
  const indexTaken = department.divisions.some(
    (div) =>
      div.basePath.replace(/\/$/, "") === deptBase &&
      div.pages.some((p) => p.segment === "")
  );

  return [
    <Route key={department.id} path={trimmed}>
      {!indexTaken && (
        <Route
          key={`${department.id}-overview`}
          index
          element={<DepartmentOverview departmentId={department.id} />}
        />
      )}
      {children}
    </Route>,
  ];
}

function buildDivisionRoutes(
  department: DepartmentNode,
  division: DivisionNode
) {
  const deptBase = department.basePath.replace(/\/$/, "");
  const divPath = division.basePath.replace(/\/$/, "");
  const relative = divPath.startsWith(`${deptBase}/`)
    ? divPath.slice(deptBase.length + 1)
    : "";

  const indexPage = division.pages.find((p) => p.segment === "");
  const subPages = division.pages.filter((p) => p.segment !== "");
  const showsBuilderParam = division.pages.some((p) => p.kind === "builder");

  const inner = [
    indexPage && (
      <Route
        key={`${division.id}-index`}
        index
        element={pageElementFor(indexPage.kind)}
      />
    ),
    ...subPages.map((p) => (
      <Route
        key={`${division.id}-${p.id}`}
        path={p.segment}
        element={pageElementFor(p.kind)}
      />
    )),
    showsBuilderParam && (
      <Route
        key={`${division.id}-builder-param`}
        path="builder/:id"
        element={pageElementFor("builder")}
      />
    ),
  ].filter(Boolean);

  if (!relative) {
    // Division shares its department's base path (e.g. brick-and-mortar/overview)
    return inner;
  }

  return [
    <Route key={division.id} path={relative}>
      {inner}
    </Route>,
  ];
}
function AuthGatedApp() {
  const { authenticated, loading, user, tenants } = useTenant();
  const { checking, needsWizard, wizardEpoch, onFinished, onOpenVault, control } = useOnboardingGate();
  const [pluginsReady, setPluginsReady] = useState(false);
  const [pluginsEpoch, setPluginsEpoch] = useState(0);
  const [saas, setSaas] = useState(false);
  const [forceAuth, setForceAuth] = useState(false);
  const { pathname, search } = useLocation();
  const isSellerLinkConnect = pathname.startsWith("/seller-link/connect");
  const isSellerLinkGithub = pathname.startsWith("/seller-link/github");
  const isSellerLinkStripe = pathname.startsWith("/seller-link/stripe");
  const isSellerLinkSurface =
    isSellerLinkConnect || isSellerLinkGithub || isSellerLinkStripe;

  useEffect(() => {
    if (!isSellerLinkSurface) return;
    const state = new URLSearchParams(search).get("state");
    if (!state) return;
    try {
      sessionStorage.setItem(
        isSellerLinkGithub
          ? SELLER_GITHUB_STATE_KEY
          : isSellerLinkStripe
            ? SELLER_STRIPE_STATE_KEY
            : SELLER_LINK_STATE_KEY,
        state
      );
    } catch {
      /* ignore */
    }
  }, [isSellerLinkSurface, isSellerLinkGithub, isSellerLinkStripe, search]);

  useEffect(() => {
    void fetchBridgeHealth()
      .then((h) => setSaas(Boolean(h.saas)))
      .catch(() => setSaas(false));
  }, []);

  // Plan: require verified email before full product use on SaaS only.
  // Platform admins skip email verification (bootstrap before Resend); MFA still required.
  const needsEmailVerify =
    saas &&
    authenticated &&
    user?.emailVerified === false &&
    user?.isAdmin !== true;
  const needsMfaSetup =
    saas &&
    authenticated &&
    !needsEmailVerify &&
    Boolean(user?.isAdmin) &&
    user?.mfaEnabled === false;
  const needsAuthInterstitial = needsEmailVerify || needsMfaSetup;
  const needsWorkspace =
    authenticated && !needsAuthInterstitial && tenants.length === 0;

  useEffect(() => {
    if (!authenticated || needsAuthInterstitial || needsWorkspace) {
      setPluginsReady(true);
      return;
    }
    setPluginsReady(false);
    void loadWebPlugins().finally(() => setPluginsReady(true));
  }, [authenticated, needsAuthInterstitial, needsWorkspace]);

  useEffect(() => {
    if (!authenticated || needsAuthInterstitial || needsWorkspace) return;
    const onPluginsChanged = () => setPluginsEpoch((n) => n + 1);
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadWebPlugins();
    };
    window.addEventListener("godmode:plugins-changed", onPluginsChanged);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("godmode:plugins-changed", onPluginsChanged);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [authenticated, needsAuthInterstitial, needsWorkspace]);

  useEffect(() => {
    const onOpenAuth = () => setForceAuth(true);
    window.addEventListener("godmode:open-auth", onOpenAuth);
    return () => window.removeEventListener("godmode:open-auth", onOpenAuth);
  }, []);

  // User node navigates to /?auth=1; honor the query so AuthGate survives remount/HMR.
  const forceAuthFromUrl = new URLSearchParams(search).get("auth") === "1";
  const showAuthGate = forceAuth || forceAuthFromUrl;

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background text-sm text-muted-foreground">
        Loading workspace…
      </div>
    );
  }

  // Pre-auth (Local + Cloud): The Graph is the main site; AuthGate only when ?auth=1.
  if (!authenticated) {
    if (showAuthGate) {
      return (
        <>
          <AuthGate />
          <Toaster richColors position="top-right" />
        </>
      );
    }
    return (
      <StructureProvider>
        <IntelligenceProvider>
          <PreAuthChatCanvas />
        </IntelligenceProvider>
      </StructureProvider>
    );
  }

  if (needsAuthInterstitial) {
    return (
      <>
        <AuthGate />
        <Toaster richColors position="top-right" />
      </>
    );
  }

  // Seller redirect bind (#706): allow connect without a full Cloud workspace.
  if (isSellerLinkConnect) {
    return (
      <>
        <SellerLinkConnectPage />
        <Toaster richColors position="top-right" />
      </>
    );
  }

  // Seller GitHub connect for Local Sell (#711): same workspace-optional surface.
  if (isSellerLinkGithub) {
    return (
      <>
        <SellerLinkGithubPage />
        <Toaster richColors position="top-right" />
      </>
    );
  }

  // Seller Stripe Connect for Local Sell (#709): workspace-optional Cloud surface.
  if (isSellerLinkStripe) {
    return (
      <>
        <SellerLinkStripePage />
        <Toaster richColors position="top-right" />
      </>
    );
  }

  if (needsWorkspace) {
    return (
      <>
        <NoWorkspaceGate />
        <Toaster richColors position="top-right" />
      </>
    );
  }

  if (checking || !pluginsReady) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background text-sm text-muted-foreground">
        Loading workspace…
      </div>
    );
  }

  return (
    <StructureProvider>
      <IntelligenceProvider>
        <PageChromeProvider>
          <OnboardingWizardProvider control={control}>
            <FirstRunWizard
              open={needsWizard}
              epoch={wizardEpoch}
              onFinished={onFinished}
              onOpenVault={onOpenVault}
            />
            {webPluginRuntime.wrapWithRootProviders(
              <AppShell key={pluginsEpoch} />
            )}
          </OnboardingWizardProvider>
        </PageChromeProvider>
      </IntelligenceProvider>
    </StructureProvider>
  );
}

export default function App() {
  return (
    <TooltipProvider delay={200}>
      <TenantProvider>
        <ChatUnlockProvider>
          <Routes>
            {marketingAtRoot ? (
              <Route path="/*" element={<MarketingRoutes />} />
            ) : (
              <>
                <Route
                  path={`${MARKETING_BASE}/*`}
                  element={<MarketingRoutes />}
                />
                <Route path="*" element={<AuthGatedApp />} />
              </>
            )}
          </Routes>
        </ChatUnlockProvider>
      </TenantProvider>
    </TooltipProvider>
  );
}
