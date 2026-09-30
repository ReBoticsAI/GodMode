/**
 * Chrome surfaces that open as Graph floating windows (Information panel tabs)
 * instead of full-route takeovers. Deep links dispatch godmode:open-* events;
 * ChatGraphCanvas selects the node and opens the panel.
 */

import {
  ADMIN_NODE_ID,
  ADMIN_PATH,
  AGENTS_PATH,
  BANK_PATH,
  CALENDAR_PATH,
  CODING_PATH,
  CONTACTS_PATH,
  MARKETPLACE_PATH,
  NOTIFICATIONS_PATH,
  PLATFORM_VAULT_NODE_ID,
  PLATFORM_VAULT_PATH,
  RELEASES_PATH,
  SETTINGS_PATH,
  SHARED_PATH,
  STRUCTURE_PATH,
  SUPPORT_PATH,
  TASKS_PATH,
  USERS_PATH,
  VAULT_PATH,
  WIKI_NODE_ID,
  WIKI_PATH,
} from "@/lib/navigation";

export type GraphFloatingSurface = {
  /** Left-rail / Information panel tab id. */
  tab: string;
  /** Architecture catalog node to select (optional for Contacts). */
  nodeId: string | null;
  /** CustomEvent name. */
  event: `godmode:open-${string}`;
  /** Index route that redirects into the Graph window. */
  path: string;
  /** Toast when unsigned-in. */
  authLabel: string;
};

/** Surfaces converted from full-route chrome to Graph floating windows. */
export const GRAPH_FLOATING_SURFACES: readonly GraphFloatingSurface[] = [
  {
    tab: "platform-vault",
    nodeId: PLATFORM_VAULT_NODE_ID,
    event: "godmode:open-platform-vault",
    path: PLATFORM_VAULT_PATH,
    authLabel: "Platform Vault",
  },
  {
    tab: "admin",
    nodeId: ADMIN_NODE_ID,
    event: "godmode:open-admin",
    path: ADMIN_PATH,
    authLabel: "Admin",
  },
  {
    tab: "wiki",
    nodeId: WIKI_NODE_ID,
    event: "godmode:open-wiki",
    path: WIKI_PATH,
    authLabel: "Wiki",
  },
  {
    tab: "personal-vault",
    nodeId: "hub:vault-you",
    event: "godmode:open-personal-vault",
    path: VAULT_PATH,
    authLabel: "Personal Vault",
  },
  {
    tab: "settings",
    nodeId: "hub:settings",
    event: "godmode:open-settings",
    path: SETTINGS_PATH,
    authLabel: "Settings",
  },
  {
    tab: "shared",
    nodeId: "hub:shared",
    event: "godmode:open-shared",
    path: SHARED_PATH,
    authLabel: "Shared",
  },
  {
    tab: "marketplace",
    nodeId: "hub:marketplace",
    event: "godmode:open-marketplace",
    path: MARKETPLACE_PATH,
    authLabel: "Marketplace",
  },
  {
    tab: "structure",
    nodeId: "hub:structure-you",
    event: "godmode:open-structure",
    path: STRUCTURE_PATH,
    authLabel: "Structure",
  },
  {
    tab: "coding",
    nodeId: "hub:coding",
    event: "godmode:open-coding",
    path: CODING_PATH,
    authLabel: "Coding",
  },
  {
    tab: "releases",
    nodeId: "hub:releases",
    event: "godmode:open-releases",
    path: RELEASES_PATH,
    authLabel: "Releases",
  },
  {
    tab: "agents",
    nodeId: "hub:agents",
    event: "godmode:open-agents",
    path: AGENTS_PATH,
    authLabel: "Agents",
  },
  {
    tab: "users",
    nodeId: "hub:users",
    event: "godmode:open-users",
    path: USERS_PATH,
    authLabel: "Profile",
  },
  {
    tab: "support",
    nodeId: "hub:support",
    event: "godmode:open-support",
    path: SUPPORT_PATH,
    authLabel: "Support",
  },
  {
    tab: "tasks",
    nodeId: "hub:tasks-you",
    event: "godmode:open-tasks",
    path: TASKS_PATH,
    authLabel: "Tasks",
  },
  {
    tab: "contacts",
    nodeId: null,
    event: "godmode:open-contacts",
    path: CONTACTS_PATH,
    authLabel: "Contacts",
  },
  {
    tab: "calendar",
    nodeId: "hub:calendar-you",
    event: "godmode:open-calendar",
    path: CALENDAR_PATH,
    authLabel: "Calendar",
  },
  {
    tab: "bank",
    nodeId: "hub:bank-you",
    event: "godmode:open-bank",
    path: BANK_PATH,
    authLabel: "Bank",
  },
  {
    tab: "notifications",
    nodeId: null,
    event: "godmode:open-notifications",
    path: NOTIFICATIONS_PATH,
    authLabel: "Notifications",
  },
] as const;

/** Exact index paths that should not paint full AppRoutes (Graph stays visible). */
export const GRAPH_FLOATING_INDEX_PATHS: ReadonlySet<string> = new Set(
  GRAPH_FLOATING_SURFACES.map((s) => s.path)
);

export function isGraphFloatingIndexPath(pathname: string): boolean {
  return GRAPH_FLOATING_INDEX_PATHS.has(pathname);
}

export function floatingSurfaceForPath(
  pathname: string
): GraphFloatingSurface | undefined {
  return GRAPH_FLOATING_SURFACES.find((s) => s.path === pathname);
}

export function floatingSurfaceForTab(
  tab: string
): GraphFloatingSurface | undefined {
  return GRAPH_FLOATING_SURFACES.find((s) => s.tab === tab);
}

export function floatingSurfaceForEvent(
  event: string
): GraphFloatingSurface | undefined {
  return GRAPH_FLOATING_SURFACES.find((s) => s.event === event);
}

/** Resolve a floating surface from tab, index path, or godmode:open-* event. */
export function resolveFloatingSurface(input: {
  tab?: string;
  path?: string;
  event?: string;
}): GraphFloatingSurface | undefined {
  if (input.tab) return floatingSurfaceForTab(input.tab);
  if (input.event) return floatingSurfaceForEvent(input.event);
  if (input.path) {
    const pathOnly = input.path.split("?")[0] ?? input.path;
    const exact = floatingSurfaceForPath(pathOnly);
    if (exact) return exact;
    return GRAPH_FLOATING_SURFACES.find(
      (s) => input.path === s.path || input.path!.startsWith(`${s.path}?`)
    );
  }
  return undefined;
}

/**
 * Match a projection node id to a floating surface, including owner-sided
 * hubs (`hub:calendar-intelligence` → calendar surface catalogued as `-you`).
 */
export function floatingSurfaceForNodeId(
  nodeId: string
): GraphFloatingSurface | undefined {
  const exact = GRAPH_FLOATING_SURFACES.find((s) => s.nodeId === nodeId);
  if (exact) return exact;
  const match = nodeId.match(
    /^hub:([a-z0-9]+)-(you|intelligence|research|ops)$/
  );
  if (!match) return undefined;
  return GRAPH_FLOATING_SURFACES.find(
    (s) => s.nodeId === `hub:${match[1]}-you`
  );
}
