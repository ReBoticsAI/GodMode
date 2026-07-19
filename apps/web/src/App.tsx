import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router-dom";
import Home from "./pages/Home";
import AgentsPage from "./pages/Agents";
import Admin from "./pages/Admin";
import Settings from "./pages/Settings";
import Vault from "./pages/Vault";
import Users from "./pages/Users";
import Shared from "./pages/Shared";
import AuthGate from "./pages/AuthGate";
import MarketingRoutes from "./pages/marketing/MarketingRoutes";
import { FirstRunWizard, useOnboardingGate } from "@/components/FirstRunWizard";
import Bank from "./pages/Bank";
import DepartmentOverview from "./pages/DepartmentOverview";
import UserCalendarPage from "./pages/UserCalendar";
import UserTasksPage from "./pages/UserTasks";
import Notifications from "./pages/Notifications";
import Support from "./pages/Support";
import Wiki from "./pages/Wiki";
import WikiPage from "./pages/WikiPage";
import RecordListPage from "./pages/records/RecordListPage";
import RecordFormPage from "./pages/records/RecordFormPage";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { SidebarShellContent } from "@/components/SidebarShellContent";
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
  RECORDS_PATH,
  MARKETPLACE_PATH,
  CONTACTS_PATH,
  SHARED_PATH,
  SETTINGS_PATH,
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
import StructureEditor from "./pages/StructureEditor";
import ContactsFlow from "./pages/ContactsFlow";
import { IntelligencePanel } from "@/components/intelligence/IntelligencePanel";
import { pageElementFor } from "@/lib/page-registry";
import { loadWebPlugins } from "@/plugins/loader";
import { webPluginRuntime } from "@/plugins/runtime";
import { useIsMobile } from "@/hooks/use-mobile";
import { useEffect, useMemo, useState, createElement, type ComponentType } from "react";
import { autoChatAgentIdForPagePath } from "@/lib/structure-agents";
import { toast } from "sonner";
import { connectWebSocket, fetchBridgeHealth } from "@/api";

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

const AI_SETTINGS_PATH = "/settings/ai";

function AppShell() {
  const { pathname } = useLocation();
  const { departments, nodes, loading } = useStructure();
  const { openPanel } = useIntelligence();
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

  const [navOpen, setNavOpen] = useState(false);
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

  // Close the off-canvas drawers whenever the route changes.
  useEffect(() => {
    setNavOpen(false);
    setRightOpen(false);
  }, [pathname]);

  // Drawers only exist in compact mode; clear them when growing to desktop.
  useEffect(() => {
    if (!isMobile) {
      setNavOpen(false);
      setRightOpen(false);
    }
  }, [isMobile]);

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      {/* Desktop primary sidebar (static rail) */}
      <aside className="hidden h-dvh w-56 shrink-0 flex-col gap-2 border-r bg-sidebar p-3 text-sidebar-foreground lg:flex">
        <SidebarShellContent />
      </aside>

      {/* Compact-mode primary nav (off-canvas drawer) */}
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent
          side="left"
          className="flex w-72 max-w-[85vw] flex-col gap-2 bg-sidebar p-3 text-sidebar-foreground"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarShellContent onNavigate={() => setNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="relative flex min-w-0 flex-1 flex-col">
        <AppHeader
          onOpenNav={() => setNavOpen(true)}
          onOpenRightPanel={
            hasRightPanel ? () => setRightOpen(true) : undefined
          }
          rightPanelKind={hasRightPanel ? division?.rightSidebar ?? undefined : undefined}
        />
        <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <AppRoutes departments={departments} loading={loading} />
        </main>
        <IntelligencePanel />
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

      <AiNotifications />
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
      <Route path="/builder/:id" element={<LegacyBuilderRedirect />} />

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

function LegacyBuilderRedirect() {
  const { id } = useParams();
  const target = id
    ? `/trading/sierra/builder/${id}`
    : "/trading/sierra/builder";
  return <Navigate to={target} replace />;
}

/**
 * Gates the authenticated app behind a real session. While the session is
 * still resolving we render nothing; an unauthenticated visitor sees the
 * AuthGate (sign in / sign up) instead of the workspace shell.
 */
function AuthGatedApp() {
  const { authenticated, loading, user } = useTenant();
  const { checking, needsWizard, refresh } = useOnboardingGate();
  const [pluginsReady, setPluginsReady] = useState(false);
  const [saas, setSaas] = useState(false);

  useEffect(() => {
    void fetchBridgeHealth()
      .then((h) => setSaas(Boolean(h.saas)))
      .catch(() => setSaas(false));
  }, []);

  // Plan: require verified email before full product use on SaaS only.
  // SaaS platform admins must also enroll MFA before the product shell.
  const needsEmailVerify = saas && authenticated && user?.emailVerified === false;
  const needsMfaSetup =
    saas &&
    authenticated &&
    !needsEmailVerify &&
    Boolean(user?.isAdmin) &&
    user?.mfaEnabled === false;
  const needsAuthInterstitial = needsEmailVerify || needsMfaSetup;

  useEffect(() => {
    if (!authenticated || needsAuthInterstitial) {
      setPluginsReady(true);
      return;
    }
    setPluginsReady(false);
    void loadWebPlugins().finally(() => setPluginsReady(true));
  }, [authenticated, needsAuthInterstitial]);

  if (loading || (authenticated && !needsAuthInterstitial && (checking || !pluginsReady))) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background text-sm text-muted-foreground">
        Loading workspace…
      </div>
    );
  }

  if (!authenticated || needsAuthInterstitial) {
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
        <PageChromeProvider>
          <FirstRunWizard open={needsWizard} onFinished={() => void refresh()} />
          {webPluginRuntime.wrapWithRootProviders(<AppShell />)}
        </PageChromeProvider>
      </IntelligenceProvider>
    </StructureProvider>
  );
}

export default function App() {
  return (
    <TooltipProvider delay={200}>
      <TenantProvider>
        <Routes>
          <Route path="/www/*" element={<MarketingRoutes />} />
          <Route path="*" element={<AuthGatedApp />} />
        </Routes>
      </TenantProvider>
    </TooltipProvider>
  );
}
