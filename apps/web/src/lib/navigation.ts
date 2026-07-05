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
export const ADMIN_PATH = "/settings/admin";
export const USERS_PATH = "/settings/users";
/** The contacts relationship graph (you ↔ everyone you collaborate with). */
export const CONTACTS_PATH = "/contacts";
export const AGENTS_PATH = "/agents";
export const BANK_PATH = "/bank";
export const VAULT_PATH = "/vault";
export const STRUCTURE_PATH = "/structure";
/** @deprecated Use BANK_PATH — kept for redirects */
export const HOLDINGS_PATH = "/holdings";
export const CALENDAR_PATH = "/calendar";
export const TASKS_PATH = "/tasks";
export const NOTIFICATIONS_PATH = "/notifications";
export const SUPPORT_PATH = "/support";
export const WIKI_PATH = "/wiki";

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
  if (norm.startsWith(CALENDAR_PATH)) return ["Calendar"];
  if (norm.startsWith(TASKS_PATH)) return ["Tasks"];
  if (norm.startsWith(BANK_PATH) || norm.startsWith(HOLDINGS_PATH)) return ["Bank"];
  if (norm.startsWith(VAULT_PATH)) return ["Vault"];
  if (norm.startsWith(AGENTS_PATH)) return ["Agents"];
  if (norm.startsWith(NOTIFICATIONS_PATH)) return ["Notifications"];
  if (norm.startsWith(SUPPORT_PATH)) return ["Support"];
  if (norm.startsWith(STRUCTURE_PATH)) return ["Structure"];
  if (norm.startsWith(MARKETPLACE_PATH)) return ["Marketplace"];
  if (norm.startsWith(CONTACTS_PATH)) return ["Contacts"];
  if (norm.startsWith(ADMIN_PATH)) return ["Admin"];
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
