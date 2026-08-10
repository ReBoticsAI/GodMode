import type { GroupTabDef } from "./group-tab-definitions";

export type RightSidebarKind = string;

/** Recursive structure page node (single node type). */
export interface StructureNode {
  id: string;
  parentId: string | null;
  label: string;
  icon: string;
  segment: string;
  path: string;
  kind: string;
  objectType: string | null;
  rightSidebar: RightSidebarKind | null;
  agentId: string | null;
  builtIn: boolean;
  sortOrder: number;
  tabs: GroupTabDef[] | null;
  children: StructureNode[];
}

/** @deprecated Legacy 3-level shape — derived from StructureNode tree via adapter. */
export interface PageNode {
  id: string;
  label: string;
  /** Icon name (kebab-case) — looked up via icon-lookup.tsx */
  icon: string;
  /** Segment after division basePath; empty string = division index route */
  segment: string;
  /** Renderer kind (`dashboard`, `routines`, ..., `placeholder`) */
  kind: string;
  objectType: string | null;
  builtIn: boolean;
  sortOrder: number;
}

export interface DivisionNode {
  id: string;
  departmentId: string;
  label: string;
  icon: string;
  basePath: string;
  rightSidebar: RightSidebarKind | null;
  builtIn: boolean;
  sortOrder: number;
  pages: PageNode[];
}

export interface DepartmentNode {
  id: string;
  label: string;
  icon: string;
  basePath: string;
  builtIn: boolean;
  sortOrder: number;
  divisions: DivisionNode[];
}

export const APP_NAME = "GodMode";
/** Display name for the platform's main AI assistant (distinct from APP_NAME). */
export const AI_NAME = "Intelligence";

export const HOME_PATH = "/home";

export const MARKETPLACE_PATH = "/marketplace";
export const SHARED_PATH = "/settings/shared";
export const STRUCTURE_SETTINGS_PATH = "/settings/structure";
export const SETTINGS_PATH = "/settings/platform";
/** Platform Vault (GodMode Cloud seats, Inference Connect, account secrets). */
export const PLATFORM_VAULT_PATH = "/settings/vault";
/** @deprecated Prefer PLATFORM_VAULT_PATH; same route (/settings/vault). */
export const USER_VAULT_PATH = PLATFORM_VAULT_PATH;
export const ADMIN_PATH = "/settings/admin";
export const USERS_PATH = "/settings/users";
/** The contacts relationship graph (you ↔ everyone you collaborate with). */
export const CONTACTS_PATH = "/contacts";
export const AGENTS_PATH = "/agents";
export const BANK_PATH = "/bank";
/** Personal Vault (integrations, wallets, marketplace, user secrets). */
export const VAULT_PATH = "/vault";

export const VAULT_TABS = [
  "cloud",
  "inference",
  "integrations",
  "wallets",
  "marketplace",
  "secrets",
  "storage",
] as const;
export type VaultTab = (typeof VAULT_TABS)[number];

/** Personal Vault `/vault` tabs (Cloud/Inference → Platform Vault; Storage → Settings → Storage). */
export const USER_VAULT_TABS = [
  "integrations",
  "wallets",
  "marketplace",
  "secrets",
] as const satisfies readonly VaultTab[];

/** Agent Vault tabs (Inference is platform-only under Platform Vault). */
export const AGENT_VAULT_TABS = ["secrets", "wallets"] as const satisfies readonly VaultTab[];

export const SETTINGS_TABS = ["general", "storage"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const PLATFORM_VAULT_SECTIONS = [
  "cloud",
  "inference",
  "secrets",
] as const;
export type PlatformVaultSection = (typeof PLATFORM_VAULT_SECTIONS)[number];

export const VAULT_INFERENCE_SUBTABS = [
  "subscriptions",
  "api-keys",
  "search",
] as const;
export type VaultInferenceSub = (typeof VAULT_INFERENCE_SUBTABS)[number];

/** Map legacy Vault ?tab= values to the current tab IA. */
export function normalizeVaultTab(raw: string | null | undefined): VaultTab {
  if (raw === "search") return "inference";
  if (raw === "billing") return "cloud";
  // Bank dual-home used separate Accounts; Vault uses one Wallets & Accounts tab.
  if (raw === "accounts") return "wallets";
  if ((VAULT_TABS as readonly string[]).includes(raw ?? "")) {
    return raw as VaultTab;
  }
  // Personal Vault default (Cloud + Inference live on Platform Vault).
  return "integrations";
}

export function normalizeSettingsTab(
  raw: string | null | undefined
): SettingsTab {
  if ((SETTINGS_TABS as readonly string[]).includes(raw ?? "")) {
    return raw as SettingsTab;
  }
  return "general";
}

/** True when Settings URL still uses the retired Vault tab (redirect to Platform Vault). */
export function isLegacySettingsVaultDeepLink(
  tab: string | null | undefined,
  vaultSection?: string | null
): boolean {
  return tab === "vault" || Boolean(vaultSection?.trim());
}

export function normalizePlatformVaultSection(
  raw: string | null | undefined
): PlatformVaultSection {
  if (raw === "secrets" || raw === "cloud") return raw;
  return "inference";
}

export function normalizeVaultInferenceSub(
  raw: string | null | undefined,
  tabRaw?: string | null
): VaultInferenceSub {
  // Legacy top-level Search tab.
  if (tabRaw === "search") return "search";
  if (
    raw === "api-keys" ||
    raw === "subscriptions" ||
    raw === "search"
  ) {
    return raw;
  }
  return "subscriptions";
}

/** Deep link into Platform Vault. */
export function platformVaultHref(
  target: VaultInferenceSub | PlatformVaultSection | "inference" = "subscriptions"
): string {
  if (target === "cloud") {
    return `${PLATFORM_VAULT_PATH}?vault=cloud`;
  }
  if (target === "secrets") {
    return `${PLATFORM_VAULT_PATH}?vault=secrets`;
  }
  if (target === "inference") {
    return `${PLATFORM_VAULT_PATH}?vault=inference&sub=subscriptions`;
  }
  return `${PLATFORM_VAULT_PATH}?vault=inference&sub=${target}`;
}

/** @deprecated Prefer platformVaultHref. Same destination. */
export const platformVaultSettingsHref = platformVaultHref;

/** Deep link into Settings → Storage (usage + workspace data). */
export function settingsStorageHref(): string {
  return `${SETTINGS_PATH}?tab=storage`;
}

/** Deep link into Personal Vault → Wallets & Accounts. */
export function userVaultWalletsHref(): string {
  return `${VAULT_PATH}?tab=wallets`;
}

/** Deep link into an Agent Vault tab. */
export function agentVaultHref(
  agentId: string,
  tab: (typeof AGENT_VAULT_TABS)[number] = "secrets"
): string {
  const id = agentId.trim();
  return `${VAULT_PATH}?agent=${encodeURIComponent(id)}&tab=${tab}`;
}

export const STRUCTURE_PATH = "/structure";
/** @deprecated Use BANK_PATH — kept for redirects */
export const HOLDINGS_PATH = "/holdings";
export const CALENDAR_PATH = "/calendar";
export const TASKS_PATH = "/tasks";
export const NOTIFICATIONS_PATH = "/notifications";
export const SUPPORT_PATH = "/support";
export const WIKI_PATH = "/wiki";
export const CODING_PATH = "/coding";
export const RECORDS_PATH = "/records";

/**
 * Routes that render standalone (no department/division chrome such as the
 * plugin right sidebar). Settings and Holdings
 * live in the sidebar footer outside the department tree.
 */
export function isChromelessPath(pathname: string): boolean {
  return (
    pathname.startsWith("/settings") ||
    pathname.startsWith(HOME_PATH) ||
    pathname.startsWith(AGENTS_PATH) ||
    pathname.startsWith(BANK_PATH) ||
    pathname.startsWith(VAULT_PATH) ||
    pathname.startsWith(HOLDINGS_PATH) ||
    pathname.startsWith(CALENDAR_PATH) ||
    pathname.startsWith(TASKS_PATH) ||
    pathname.startsWith(NOTIFICATIONS_PATH) ||
    pathname.startsWith(SUPPORT_PATH) ||
    pathname.startsWith(WIKI_PATH) ||
    pathname.startsWith(CODING_PATH) ||
    pathname.startsWith(RECORDS_PATH) ||
    pathname.startsWith(STRUCTURE_PATH) ||
    pathname.startsWith(CONTACTS_PATH) ||
    pathname.startsWith(MARKETPLACE_PATH)
  );
}

/** Breadcrumb segments for routes outside the department tree (wiki, home, …). */
export function chromelessHeaderSegments(pathname: string): string[] | null {
  if (!isChromelessPath(pathname)) return null;
  const norm =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;

  if (norm.startsWith(HOME_PATH)) return ["Home"];
  if (norm.startsWith(WIKI_PATH)) return ["Wiki"];
  if (norm.startsWith(CODING_PATH)) return ["Coding"];
  if (norm.startsWith(RECORDS_PATH)) return ["Records"];
  if (norm.startsWith(CALENDAR_PATH)) return ["Calendar"];
  if (norm.startsWith(TASKS_PATH)) return ["Tasks"];
  if (norm.startsWith(BANK_PATH) || norm.startsWith(HOLDINGS_PATH)) return ["Bank"];
  if (norm.startsWith(VAULT_PATH)) return ["Personal Vault"];
  if (norm.startsWith(AGENTS_PATH)) return ["Agents"];
  if (norm.startsWith(NOTIFICATIONS_PATH)) return ["Notifications"];
  if (norm.startsWith(SUPPORT_PATH)) return ["Support"];
  if (norm.startsWith(STRUCTURE_PATH)) return ["Structure"];
  if (norm.startsWith(MARKETPLACE_PATH)) return ["Marketplace"];
  if (norm.startsWith(CONTACTS_PATH)) return ["Contacts"];
  if (norm.startsWith(ADMIN_PATH)) return ["Admin"];
  if (norm.startsWith(PLATFORM_VAULT_PATH)) return ["Platform Vault"];
  if (norm.startsWith(STRUCTURE_SETTINGS_PATH)) return ["Settings", "Workspace template"];
  if (norm.startsWith(USERS_PATH)) return ["Profile"];
  if (norm.startsWith(SHARED_PATH)) return ["Settings", "Shared"];
  if (norm.startsWith("/settings")) return ["Settings"];
  return ["Platform"];
}

/** Full route for a page under a division. */
export function pageHref(division: DivisionNode, page: PageNode): string {
  const base = division.basePath.replace(/\/$/, "");
  if (!page.segment) return base || "/";
  return `${base}/${page.segment}`;
}

/** Default landing route for a division (its index page, else first page). */
export function defaultPathForDivision(division: DivisionNode): string {
  const page =
    division.pages.find((p) => p.segment === "") ?? division.pages[0];
  if (!page) return division.basePath;
  return pageHref(division, page);
}

/** Default landing route when switching to a department. */
export function defaultPathForDepartment(
  department: DepartmentNode
): string {
  const division = department.divisions[0];
  if (!division) return department.basePath;
  return defaultPathForDivision(division);
}

function normalizePath(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  return pathname.endsWith("/") && pathname.length > 1
    ? pathname.slice(0, -1)
    : pathname;
}

export function departmentFromPath(
  pathname: string,
  departments: DepartmentNode[]
): DepartmentNode | undefined {
  if (departments.length === 0) return undefined;
  const path = normalizePath(pathname);
  const sorted = [...departments].sort(
    (a, b) => b.basePath.length - a.basePath.length
  );
  for (const d of sorted) {
    const base = normalizePath(d.basePath);
    if (path === base || path.startsWith(`${base}/`)) return d;
  }
  return departments[0];
}

export function divisionFromPath(
  pathname: string,
  departments: DepartmentNode[]
): DivisionNode | undefined {
  const dept = departmentFromPath(pathname, departments);
  if (!dept) return undefined;
  const path = normalizePath(pathname);
  const sorted = [...dept.divisions].sort(
    (a, b) => b.basePath.length - a.basePath.length
  );
  for (const d of sorted) {
    const base = normalizePath(d.basePath);
    if (path === base || path.startsWith(`${base}/`)) return d;
  }
  return dept.divisions[0];
}
