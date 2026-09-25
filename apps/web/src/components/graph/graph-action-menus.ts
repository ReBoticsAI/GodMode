/**
 * Shared Graph top-action inventories.
 *
 * Modes mirror ChatGraphCanvas GRAPH_ACTION_MODES:
 * Create, Edit, Organize, Connect, Monitor, Execute, Validate, Govern.
 *
 * Browse pattern (ChatGraphCanvas):
 * 1. Action bar ToggleGroup selects a mode.
 * 2. GraphActionBrowsePanel lists items from GRAPH_ACTION_MENUS / graphActionItemsFor.
 * 3. Chat composer filters that mode's list (label, description, group).
 * 4. onSelect(kind) runs the mode's select*Kind handler.
 *    Enter in the composer selects the first match while browse is open.
 *
 * Keep inventories here. Do not invent parallel item lists in the canvas.
 *
 * needsDashboard: item should eventually open a dedicated dashboard/page; lists show it now.
 * systemOnly: editable/governable system surface that is not creatable from Graph Create.
 */

export const GRAPH_ACTION_MODE_IDS = [
  "create",
  "edit",
  "organize",
  "connect",
  "monitor",
  "execute",
  "validate",
  "govern",
] as const;

export type GraphActionModeId = (typeof GRAPH_ACTION_MODE_IDS)[number];

/** Suggested CTA shapes for menu wiring (aligns with architecture catalog CTAs). */
export type GraphActionMenuCta =
  | { type: "open_chat" }
  | { type: "open_panel"; tab: string; subTab?: string }
  | { type: "navigate"; path: string }
  | { type: "open_auth" }
  | { type: "dialog"; id: string }
  | { type: "select_kind" }
  | { type: "none" };

export type GraphActionMenuItem = {
  id: string;
  label: string;
  description?: string;
  /** Lucide export basename without Icon suffix (e.g. "Bot" → BotIcon). */
  icon?: string;
  group?: string;
  /** Needs a dedicated dashboard/page beyond existing panels. */
  needsDashboard?: boolean;
  /** System surface: edit/govern only, not Graph Create. */
  systemOnly?: boolean;
  cta?: GraphActionMenuCta;
};

// ─── Create ─────────────────────────────────────────────────────────────────
// Canonical Graph Create kinds. Keep ids stable; GraphCreateKindMenu consumes these.

export const GRAPH_ACTION_CREATE_ITEMS = [
  {
    id: "chat",
    label: "Chat",
    description: "Start a new chat session with the active agent.",
    icon: "MessageCircle",
    group: "Conversation",
    cta: { type: "open_chat" },
  },
  {
    id: "agent",
    label: "Agent",
    description: "Create a specialized agent under Workspaces or Intelligence.",
    icon: "Bot",
    group: "Agents",
    cta: { type: "select_kind" },
  },
  {
    id: "page",
    label: "Page",
    description: "Add a Structure page (surface) under a department or division.",
    icon: "FilePlus",
    group: "Structure",
    cta: { type: "select_kind" },
  },
  {
    id: "workspace",
    label: "Workspace",
    description: "Create a tenant workspace (project).",
    icon: "Layers",
    group: "Structure",
    cta: { type: "dialog", id: "create-workspace" },
  },
  {
    id: "department",
    label: "Department",
    description: "Add a Structure department (region) to the anatomy tree.",
    icon: "FolderTree",
    group: "Structure",
    needsDashboard: true,
    cta: { type: "navigate", path: "/structure" },
  },
  {
    id: "division",
    label: "Division",
    description: "Add a Structure division under a department.",
    icon: "FolderTree",
    group: "Structure",
    needsDashboard: true,
    cta: { type: "navigate", path: "/structure" },
  },
  {
    id: "wiki",
    label: "Wiki page",
    description: "Create a markdown wiki page in Knowledge.",
    icon: "BookOpen",
    group: "Knowledge",
    cta: { type: "open_panel", tab: "wiki" },
  },
  {
    id: "event",
    label: "Event",
    description: "Add a calendar event.",
    icon: "CalendarDays",
    group: "Productivity",
    cta: { type: "open_panel", tab: "calendar" },
  },
  {
    id: "task",
    label: "Task",
    description: "Create a kanban card on a Tasks board.",
    icon: "ListChecks",
    group: "Productivity",
    cta: { type: "navigate", path: "/tasks" },
  },
  {
    id: "task-board",
    label: "Task board",
    description: "Create a personal kanban board.",
    icon: "Columns3",
    group: "Productivity",
    needsDashboard: true,
    cta: { type: "navigate", path: "/tasks" },
  },
  {
    id: "skill",
    label: "Skill",
    description: "Add a reusable agent skill (playbook).",
    icon: "Sparkles",
    group: "Knowledge",
    cta: { type: "open_panel", tab: "knowledge", subTab: "skills" },
  },
  {
    id: "memory",
    label: "Memory",
    description: "Store a semantic memory fact for an agent.",
    icon: "Brain",
    group: "Knowledge",
    cta: { type: "open_panel", tab: "knowledge", subTab: "memory" },
  },
  {
    id: "tool",
    label: "Tool",
    description: "Register or allowlist a tool definition for an agent.",
    icon: "Wrench",
    group: "Knowledge",
    needsDashboard: true,
    cta: { type: "open_panel", tab: "knowledge", subTab: "tools" },
  },
  {
    id: "artifact",
    label: "Artifact",
    description: "Capture a generated artifact linked to agent work.",
    icon: "Package",
    group: "Knowledge",
    needsDashboard: true,
    cta: { type: "open_panel", tab: "knowledge", subTab: "artifacts" },
  },
  {
    id: "secret",
    label: "Secret",
    description: "Add a free-form vault secret (prefer named Connect cards when available).",
    icon: "KeyRound",
    group: "Secrets",
    cta: { type: "open_panel", tab: "vault" },
  },
  {
    id: "automation",
    label: "Automation",
    description: "Create a workflow, hook, or schedule under Automations.",
    icon: "Workflow",
    group: "Automations",
    needsDashboard: true,
    cta: { type: "select_kind" },
  },
  {
    id: "workflow",
    label: "Workflow",
    description: "Executable guidance graph (trigger → skill/tool/agent → output).",
    icon: "GitBranch",
    group: "Automations",
    needsDashboard: true,
    cta: { type: "select_kind" },
  },
  {
    id: "schedule",
    label: "Schedule",
    description: "Cron-driven automation that can run a workflow or agent.",
    icon: "Clock",
    group: "Automations",
    needsDashboard: true,
    cta: { type: "select_kind" },
  },
  {
    id: "hook",
    label: "Hook",
    description: "Event-driven automation (platform events, coding gates).",
    icon: "Webhook",
    group: "Automations",
    needsDashboard: true,
    cta: { type: "select_kind" },
  },
  {
    id: "rule",
    label: "Rule",
    description: "Behavior constraint attached to the active agent.",
    icon: "ScrollText",
    group: "Knowledge",
    cta: { type: "open_panel", tab: "knowledge", subTab: "rules" },
  },
  {
    id: "contact",
    label: "Contact",
    description: "Add a person or relationship to your social graph.",
    icon: "UserPlus",
    group: "Social",
    cta: { type: "open_panel", tab: "chat" },
  },
  {
    id: "dm",
    label: "Direct message",
    description: "Start a DM with a user or agent.",
    icon: "Mail",
    group: "Social",
    cta: { type: "open_panel", tab: "chat" },
  },
  {
    id: "channel",
    label: "Channel",
    description: "Create a group conversation channel.",
    icon: "Hash",
    group: "Social",
    needsDashboard: true,
    cta: { type: "open_panel", tab: "chat" },
  },
  {
    id: "support-ticket",
    label: "Support ticket",
    description: "Open a platform or shared-resource support ticket.",
    icon: "LifeBuoy",
    group: "Social",
    cta: { type: "navigate", path: "/support" },
  },
  {
    id: "record",
    label: "Record",
    description: "Create an ObjectType record via a record-form page.",
    icon: "Database",
    group: "Structure",
    needsDashboard: true,
    cta: { type: "navigate", path: "/records" },
  },
  {
    id: "marketplace-listing",
    label: "Marketplace listing",
    description: "List a pack or connector on Community (Sell).",
    icon: "Store",
    group: "Marketplace",
    needsDashboard: true,
    cta: { type: "navigate", path: "/marketplace?tab=seller" },
  },
  {
    id: "share-grant",
    label: "Share grant",
    description: "Grant another user live access to a shared resource.",
    icon: "Share2",
    group: "Social",
    needsDashboard: true,
    cta: { type: "navigate", path: "/settings/shared" },
  },
] as const satisfies readonly GraphActionMenuItem[];

export type GraphCreateKind = (typeof GRAPH_ACTION_CREATE_ITEMS)[number]["id"];

export function labelForCreateKind(kind: GraphCreateKind): string {
  return (
    GRAPH_ACTION_CREATE_ITEMS.find((k) => k.id === kind)?.label ?? kind
  );
}

/** @deprecated Prefer GRAPH_ACTION_CREATE_ITEMS; kept for existing Create menu imports. */
export const GRAPH_CREATE_KINDS = GRAPH_ACTION_CREATE_ITEMS.map((k) => ({
  id: k.id,
  label: k.label,
})) as ReadonlyArray<{ id: GraphCreateKind; label: string }>;

// ─── Edit (includes system-only surfaces Create cannot invent) ──────────────

export const GRAPH_ACTION_EDIT_ITEMS = [
  {
    id: "hub-settings",
    label: "Hub settings",
    description: "Bridge / Hub connection and instance identity.",
    icon: "Server",
    group: "System",
    systemOnly: true,
    needsDashboard: true,
    cta: { type: "none" },
  },
  {
    id: "you-profile",
    label: "User profile",
    description: "Display name, account, and profile on You.",
    icon: "User",
    group: "System",
    systemOnly: true,
    cta: { type: "navigate", path: "/settings/users" },
  },
  {
    id: "digital-you",
    label: "Digital You",
    description: "Twin agent preferences and voice learning.",
    icon: "UserRound",
    group: "Agents",
    systemOnly: true,
    needsDashboard: true,
    cta: { type: "open_chat" },
  },
  {
    id: "intelligence",
    label: "Intelligence",
    description: "Platform agent settings, modes, and pipeline.",
    icon: "Brain",
    group: "Agents",
    systemOnly: true,
    needsDashboard: true,
    cta: { type: "open_chat" },
  },
  {
    id: "agent",
    label: "Agent",
    description: "Name, parent, pipeline, and harness for a specialized agent.",
    icon: "Bot",
    group: "Agents",
    cta: { type: "navigate", path: "/agents" },
  },
  {
    id: "agent-pipeline",
    label: "Agent pipeline",
    description: "Model, tools, and autonomy for the selected agent.",
    icon: "Waypoints",
    group: "Agents",
    needsDashboard: true,
    cta: { type: "navigate", path: "/agents" },
  },
  {
    id: "chat",
    label: "Chat",
    description: "Rename or retarget an existing chat session.",
    icon: "MessageCircle",
    group: "Conversation",
    needsDashboard: true,
    cta: { type: "open_chat" },
  },
  {
    id: "workspace",
    label: "Workspace",
    description: "Rename workspace, members, and project settings.",
    icon: "Layers",
    group: "Structure",
    needsDashboard: true,
    cta: { type: "navigate", path: "/settings/platform" },
  },
  {
    id: "structure",
    label: "Structure",
    description: "Edit departments, divisions, and pages in the anatomy tree.",
    icon: "FolderTree",
    group: "Structure",
    cta: { type: "navigate", path: "/structure" },
  },
  {
    id: "page",
    label: "Page",
    description: "Edit page title, kind, and placement.",
    icon: "FileText",
    group: "Structure",
    cta: { type: "navigate", path: "/structure" },
  },
  {
    id: "department",
    label: "Department",
    description: "Rename or reparent a Structure department.",
    icon: "FolderTree",
    group: "Structure",
    cta: { type: "navigate", path: "/structure" },
  },
  {
    id: "division",
    label: "Division",
    description: "Rename or reparent a Structure division.",
    icon: "FolderTree",
    group: "Structure",
    cta: { type: "navigate", path: "/structure" },
  },
  {
    id: "wiki",
    label: "Wiki page",
    description: "Edit markdown, visibility, and space.",
    icon: "BookOpen",
    group: "Knowledge",
    cta: { type: "open_panel", tab: "wiki" },
  },
  {
    id: "memory",
    label: "Memory",
    description: "Update or scope a stored memory fact.",
    icon: "Brain",
    group: "Knowledge",
    cta: { type: "open_panel", tab: "knowledge", subTab: "memory" },
  },
  {
    id: "skill",
    label: "Skill",
    description: "Edit skill body and invocation metadata.",
    icon: "Sparkles",
    group: "Knowledge",
    cta: { type: "open_panel", tab: "knowledge", subTab: "skills" },
  },
  {
    id: "rule",
    label: "Rule",
    description: "Edit agent behavior rules.",
    icon: "ScrollText",
    group: "Knowledge",
    cta: { type: "open_panel", tab: "knowledge", subTab: "rules" },
  },
  {
    id: "tool-allowlist",
    label: "Tool allowlist",
    description: "Which tools Hub will execute for this agent.",
    icon: "Wrench",
    group: "Knowledge",
    systemOnly: true,
    needsDashboard: true,
    cta: { type: "open_panel", tab: "knowledge", subTab: "tools" },
  },
  {
    id: "artifact",
    label: "Artifact",
    description: "Edit artifact metadata or linked outputs.",
    icon: "Package",
    group: "Knowledge",
    needsDashboard: true,
    cta: { type: "open_panel", tab: "knowledge", subTab: "artifacts" },
  },
  {
    id: "reflection",
    label: "Reflection proposal",
    description: "Review or revise queued knowledge proposals before merge.",
    icon: "Lightbulb",
    group: "Knowledge",
    systemOnly: true,
    needsDashboard: true,
    cta: { type: "open_panel", tab: "knowledge", subTab: "reflection" },
  },
  {
    id: "workflow",
    label: "Workflow",
    description: "Edit automation workflow graph and enablement.",
    icon: "GitBranch",
    group: "Automations",
    needsDashboard: true,
    cta: { type: "select_kind" },
  },
  {
    id: "schedule",
    label: "Schedule",
    description: "Edit cron expression and target workflow/agent.",
    icon: "Clock",
    group: "Automations",
    needsDashboard: true,
    cta: { type: "select_kind" },
  },
  {
    id: "hook",
    label: "Hook",
    description: "Edit event triggers and automation actions.",
    icon: "Webhook",
    group: "Automations",
    needsDashboard: true,
    cta: { type: "select_kind" },
  },
  {
    id: "event",
    label: "Event",
    description: "Edit a calendar event.",
    icon: "CalendarDays",
    group: "Productivity",
    cta: { type: "open_panel", tab: "calendar" },
  },
  {
    id: "task",
    label: "Task",
    description: "Edit kanban card fields, labels, and links.",
    icon: "ListChecks",
    group: "Productivity",
    cta: { type: "navigate", path: "/tasks" },
  },
  {
    id: "task-board",
    label: "Task board",
    description: "Rename board, columns, and GitHub Project link.",
    icon: "Columns3",
    group: "Productivity",
    needsDashboard: true,
    cta: { type: "navigate", path: "/tasks" },
  },
  {
    id: "user-vault-secrets",
    label: "User Vault secrets",
    description: "Personal Vault free-form secrets and named cards.",
    icon: "Vault",
    group: "Vault & Bank",
    systemOnly: true,
    cta: { type: "navigate", path: "/vault?tab=secrets" },
  },
  {
    id: "agent-vault-secrets",
    label: "Agent Vault secrets",
    description: "Secrets and wallets private to a selected agent.",
    icon: "KeyRound",
    group: "Vault & Bank",
    systemOnly: true,
    cta: { type: "open_panel", tab: "vault" },
  },
  {
    id: "platform-vault",
    label: "Platform Vault",
    description: "Cloud seats, Inference keys, and platform secrets.",
    icon: "KeyRound",
    group: "Vault & Bank",
    systemOnly: true,
    cta: { type: "open_panel", tab: "platform-vault" },
  },
  {
    id: "bank-connections",
    label: "Bank connections",
    description: "Edit linked holdings and account connections.",
    icon: "Landmark",
    group: "Vault & Bank",
    systemOnly: true,
    cta: { type: "open_panel", tab: "bank" },
  },
  {
    id: "wallet",
    label: "Wallet",
    description: "Edit wallet metadata under Vault or Bank.",
    icon: "Wallet",
    group: "Vault & Bank",
    systemOnly: true,
    cta: { type: "navigate", path: "/vault?tab=wallets" },
  },
  {
    id: "integrations",
    label: "Integrations",
    description: "GitHub App and other Personal Vault integrations.",
    icon: "Plug",
    group: "Vault & Bank",
    systemOnly: true,
    cta: { type: "navigate", path: "/vault?tab=integrations" },
  },
  {
    id: "models",
    label: "Models",
    description: "Default model, catalog prefs, and harness profiles.",
    icon: "Cpu",
    group: "Settings",
    systemOnly: true,
    needsDashboard: true,
    cta: { type: "open_chat" },
  },
  {
    id: "theme",
    label: "Theme",
    description: "Light, dark, or system appearance.",
    icon: "Palette",
    group: "Settings",
    systemOnly: true,
    cta: { type: "navigate", path: "/settings/platform?tab=general" },
  },
  {
    id: "notifications-prefs",
    label: "Notification preferences",
    description: "Which platform alerts you receive.",
    icon: "Bell",
    group: "Settings",
    systemOnly: true,
    needsDashboard: true,
    cta: { type: "open_panel", tab: "notifications" },
  },
  {
    id: "slash-commands",
    label: "Slash commands",
    description: "Custom /commands available in chat.",
    icon: "Slash",
    group: "Settings",
    systemOnly: true,
    needsDashboard: true,
    cta: { type: "navigate", path: "/settings/platform" },
  },
  {
    id: "account-security",
    label: "Account & MFA",
    description: "Password, MFA enroll/disable, session sign-out.",
    icon: "Shield",
    group: "Settings",
    systemOnly: true,
    cta: { type: "navigate", path: "/settings/platform?tab=general" },
  },
  {
    id: "storage",
    label: "Storage & export",
    description: "Database usage and workspace data export.",
    icon: "HardDrive",
    group: "Settings",
    systemOnly: true,
    cta: { type: "navigate", path: "/settings/platform?tab=storage" },
  },
  {
    id: "graph-layout",
    label: "Graph layout",
    description: "Saved Graph camera, collapse, and wing preferences.",
    icon: "Orbit",
    group: "System",
    systemOnly: true,
    needsDashboard: true,
    cta: { type: "none" },
  },
  {
    id: "permissions",
    label: "Permissions",
    description: "Workspace role (owner/editor) and share scopes.",
    icon: "Lock",
    group: "Governance",
    systemOnly: true,
    needsDashboard: true,
    cta: { type: "navigate", path: "/settings/shared" },
  },
  {
    id: "contact",
    label: "Contact",
    description: "Edit relationship graph edges and contact details.",
    icon: "Users",
    group: "Social",
    cta: { type: "open_panel", tab: "chat" },
  },
  {
    id: "channel",
    label: "Channel",
    description: "Edit channel membership and settings.",
    icon: "Hash",
    group: "Social",
    needsDashboard: true,
    cta: { type: "open_panel", tab: "chat" },
  },
  {
    id: "support-ticket",
    label: "Support ticket",
    description: "Update status, reply, or promote to a task.",
    icon: "LifeBuoy",
    group: "Social",
    cta: { type: "navigate", path: "/support" },
  },
  {
    id: "share-grant",
    label: "Share grant",
    description: "Revoke or adjust live shared-resource grants.",
    icon: "Share2",
    group: "Social",
    cta: { type: "navigate", path: "/settings/shared" },
  },
  {
    id: "marketplace-install",
    label: "Installed plugin",
    description: "Configure or remove an installed Marketplace pack.",
    icon: "Puzzle",
    group: "Marketplace",
    systemOnly: true,
    cta: { type: "navigate", path: "/marketplace?tab=installed" },
  },
  {
    id: "marketplace-listing",
    label: "Marketplace listing",
    description: "Edit Sell listing, payouts, and ToS acceptance.",
    icon: "Store",
    group: "Marketplace",
    needsDashboard: true,
    cta: { type: "navigate", path: "/marketplace?tab=seller" },
  },
  {
    id: "coding-workspace",
    label: "Coding workspace",
    description: "Coding root paths and stage preferences.",
    icon: "Code2",
    group: "Productivity",
    systemOnly: true,
    needsDashboard: true,
    cta: { type: "navigate", path: "/coding" },
  },
  {
    id: "record",
    label: "Record",
    description: "Update an ObjectType record via record-form.",
    icon: "Database",
    group: "Structure",
    cta: { type: "navigate", path: "/records" },
  },
  {
    id: "owner-surfaces",
    label: "Owner surfaces",
    description: "Inspect Structure / Knowledge / Automations / Calendar under an owner.",
    icon: "FolderTree",
    group: "System",
    systemOnly: true,
    needsDashboard: true,
    cta: { type: "none" },
  },
  {
    id: "workspace-template",
    label: "Workspace template",
    description: "Admin/template defaults for new workspaces.",
    icon: "LayoutTemplate",
    group: "Governance",
    systemOnly: true,
    cta: { type: "navigate", path: "/settings/admin" },
  },
] as const satisfies readonly GraphActionMenuItem[];

export type GraphEditKind = (typeof GRAPH_ACTION_EDIT_ITEMS)[number]["id"];

export function labelForEditKind(kind: GraphEditKind): string {
  return GRAPH_ACTION_EDIT_ITEMS.find((k) => k.id === kind)?.label ?? kind;
}

/** @deprecated Prefer GRAPH_ACTION_EDIT_ITEMS; kept for Edit menu imports. */
export const GRAPH_EDIT_KINDS = GRAPH_ACTION_EDIT_ITEMS.map((k) => ({
  id: k.id,
  label: k.label,
  group: k.group,
})) as ReadonlyArray<{ id: GraphEditKind; label: string; group?: string }>;

// ─── Organize ───────────────────────────────────────────────────────────────
// IDs match GraphOrganizeKindMenu / ChatGraphCanvas selectOrganizeKind.

export const GRAPH_ACTION_ORGANIZE_ITEMS = [
  { id: "structure-editor", label: "Structure editor", description: "Open the anatomy editor.", icon: "FolderTree", group: "Hierarchy", cta: { type: "navigate", path: "/structure" } },
  { id: "departments", label: "Departments", description: "Organize Structure departments.", icon: "FolderTree", group: "Hierarchy", cta: { type: "navigate", path: "/structure" } },
  { id: "divisions", label: "Divisions", description: "Organize Structure divisions.", icon: "FolderTree", group: "Hierarchy", cta: { type: "navigate", path: "/structure" } },
  { id: "pages-tree", label: "Pages tree", description: "Reorder pages under divisions.", icon: "FileText", group: "Hierarchy", cta: { type: "navigate", path: "/structure" } },
  { id: "folders", label: "Folders", description: "Folder grouping for pages and wiki.", icon: "Folder", group: "Hierarchy", needsDashboard: true, cta: { type: "none" } },
  { id: "workspaces-hierarchy", label: "Workspaces hierarchy", description: "Arrange Personal vs project workspaces.", icon: "Layers", group: "Hierarchy", needsDashboard: true, cta: { type: "none" } },
  { id: "owner-surfaces-hierarchy", label: "Owner surfaces", description: "Structure / Knowledge / Automations / Calendar under You or an agent.", icon: "FolderTree", group: "Hierarchy", needsDashboard: true, cta: { type: "none" } },
  { id: "vault-hierarchy", label: "Vault hierarchy", description: "Organize vault scopes and secret groups.", icon: "Vault", group: "Hierarchy", cta: { type: "navigate", path: "/vault" } },
  { id: "expand-all", label: "Expand all", description: "Expand collapsed Graph subtrees.", icon: "UnfoldVertical", group: "Collapse", cta: { type: "none" } },
  { id: "collapse-all", label: "Collapse all", description: "Collapse Graph subtrees to the spine.", icon: "FoldVertical", group: "Collapse", cta: { type: "none" } },
  { id: "reset-default-land", label: "Reset to default land", description: "Restore default-land collapse for You.", icon: "RotateCcw", group: "Collapse", cta: { type: "none" } },
  { id: "expand-selected", label: "Expand selected branch", description: "Expand the selected node branch.", icon: "Maximize2", group: "Collapse", needsDashboard: true, cta: { type: "none" } },
  { id: "collapse-selected", label: "Collapse selected branch", description: "Collapse the selected node branch.", icon: "Minimize2", group: "Collapse", needsDashboard: true, cta: { type: "none" } },
  { id: "collapse-siblings", label: "Collapse sibling branches", description: "Collapse peers of the selected node.", icon: "Minimize2", group: "Collapse", needsDashboard: true, cta: { type: "none" } },
  { id: "sort-by-name", label: "Sort by name", description: "Sort siblings alphabetically.", icon: "ArrowDownAZ", group: "Sorting", needsDashboard: true, cta: { type: "none" } },
  { id: "sort-by-kind", label: "Sort by kind", description: "Sort siblings by node kind.", icon: "Shapes", group: "Sorting", needsDashboard: true, cta: { type: "none" } },
  { id: "sort-by-recency", label: "Sort by recency", description: "Sort by last activity.", icon: "History", group: "Sorting", needsDashboard: true, cta: { type: "none" } },
  { id: "sort-custom-order", label: "Custom sort order", description: "Saved manual sibling order.", icon: "ListOrdered", group: "Sorting", needsDashboard: true, cta: { type: "none" } },
  { id: "manual-rearrange", label: "Manual rearrange", description: "Drag nodes to rearrange.", icon: "Move", group: "Sorting", needsDashboard: true, cta: { type: "none" } },
  { id: "pin-node", label: "Pin node", description: "Pin a Graph node for quick return.", icon: "Pin", group: "Pinning", needsDashboard: true, cta: { type: "none" } },
  { id: "unpin-node", label: "Unpin node", description: "Remove a pin from a Graph node.", icon: "PinOff", group: "Pinning", needsDashboard: true, cta: { type: "none" } },
  { id: "pin-to-top", label: "Pin to top", description: "Keep a node at the top of its group.", icon: "Pin", group: "Pinning", needsDashboard: true, cta: { type: "none" } },
  { id: "manage-favorites", label: "Manage favorites", description: "Manage favorite Graph nodes.", icon: "Star", group: "Pinning", needsDashboard: true, cta: { type: "none" } },
  { id: "manage-tags", label: "Manage tags", description: "Create and rename Graph tags.", icon: "Tags", group: "Tags", needsDashboard: true, cta: { type: "none" } },
  { id: "tag-selected", label: "Tag selected", description: "Apply tags to the selected node.", icon: "Tag", group: "Tags", needsDashboard: true, cta: { type: "none" } },
  { id: "filter-by-tag", label: "Filter by tag", description: "Show only nodes with a tag.", icon: "Filter", group: "Tags", needsDashboard: true, cta: { type: "none" } },
  { id: "clear-tags", label: "Clear tags", description: "Clear tags from the selection.", icon: "Eraser", group: "Tags", needsDashboard: true, cta: { type: "none" } },
  { id: "show-archived", label: "Show archived", description: "Reveal archived Graph entities.", icon: "Archive", group: "Archives", needsDashboard: true, cta: { type: "none" } },
  { id: "archive-selected", label: "Archive selected", description: "Archive the selected entity.", icon: "Archive", group: "Archives", needsDashboard: true, cta: { type: "none" } },
  { id: "restore-archived", label: "Restore from archive", description: "Restore an archived entity.", icon: "ArchiveRestore", group: "Archives", needsDashboard: true, cta: { type: "none" } },
  { id: "hide-archived", label: "Hide archived", description: "Hide archived entities from the Graph.", icon: "EyeOff", group: "Archives", needsDashboard: true, cta: { type: "none" } },
  { id: "auto-layout", label: "Auto layout", description: "Run automatic Graph layout.", icon: "Orbit", group: "Layout", needsDashboard: true, cta: { type: "none" } },
  { id: "reset-positions", label: "Reset positions", description: "Reset camera and node framing.", icon: "RotateCcw", group: "Layout", cta: { type: "none" } },
  { id: "group-by-workspace", label: "Group by workspace", description: "Cluster nodes by workspace.", icon: "Layers", group: "Layout", needsDashboard: true, cta: { type: "none" } },
  { id: "group-by-department", label: "Group by department", description: "Cluster nodes by department.", icon: "FolderTree", group: "Layout", needsDashboard: true, cta: { type: "none" } },
  { id: "declutter", label: "Declutter view", description: "Hide low-priority chrome and edges.", icon: "Sparkles", group: "Layout", needsDashboard: true, cta: { type: "none" } },
  { id: "save-layout", label: "Save layout", description: "Persist Graph layout preferences.", icon: "Save", group: "Layout", cta: { type: "none" } },
  { id: "restore-layout", label: "Restore layout", description: "Restore a saved Graph layout.", icon: "Undo2", group: "Layout", needsDashboard: true, cta: { type: "none" } },
] as const satisfies readonly GraphActionMenuItem[];

export type GraphOrganizeKind =
  (typeof GRAPH_ACTION_ORGANIZE_ITEMS)[number]["id"];

export function labelForOrganizeKind(kind: GraphOrganizeKind): string {
  return GRAPH_ACTION_ORGANIZE_ITEMS.find((k) => k.id === kind)?.label ?? kind;
}

/** @deprecated Prefer GRAPH_ACTION_ORGANIZE_ITEMS. */
export const GRAPH_ORGANIZE_KINDS = GRAPH_ACTION_ORGANIZE_ITEMS.map((k) => ({
  id: k.id,
  label: k.label,
  group: k.group,
})) as ReadonlyArray<{ id: GraphOrganizeKind; label: string; group?: string }>;

// ─── Connect ────────────────────────────────────────────────────────────────
// IDs match GraphConnectKindMenu / ChatGraphCanvas connect wiring.

export const GRAPH_ACTION_CONNECT_ITEMS = [
  { id: "graph-edge", label: "Graph edge", description: "Connect two Graph nodes with a labeled relationship.", icon: "Spline", group: "Graph", needsDashboard: true, cta: { type: "none" } },
  { id: "workspace-link", label: "Workspace link", description: "Link related workspaces on the Graph.", icon: "Layers", group: "Graph", needsDashboard: true, cta: { type: "none" } },
  { id: "structure-link", label: "Structure link", description: "Connect Structure nodes in the anatomy tree.", icon: "FolderTree", group: "Graph", cta: { type: "navigate", path: "/structure" } },
  { id: "agent-assignment", label: "Agent assignment", description: "Assign an agent under a workspace or parent.", icon: "Bot", group: "Graph", cta: { type: "navigate", path: "/agents" } },
  { id: "agent-handoff", label: "Agent handoff", description: "Wire handoff edges between agents.", icon: "ArrowRightLeft", group: "Graph", needsDashboard: true, cta: { type: "navigate", path: "/agents" } },
  { id: "contact", label: "Contact", description: "Connect a person in the social graph.", icon: "UserPlus", group: "People", cta: { type: "open_panel", tab: "chat" } },
  { id: "direct-message", label: "Direct message", description: "Open or start a DM thread.", icon: "Mail", group: "People", cta: { type: "open_panel", tab: "chat" } },
  { id: "channel", label: "Channel", description: "Join or create a channel.", icon: "Hash", group: "People", needsDashboard: true, cta: { type: "open_panel", tab: "chat" } },
  { id: "peer-invite", label: "Peer invite", description: "Invite a federated peer via Shared.", icon: "Share2", group: "People", cta: { type: "navigate", path: "/settings/shared" } },
  { id: "integration", label: "Integration", description: "Personal Vault integrations hub.", icon: "Plug", group: "Integrations", cta: { type: "navigate", path: "/vault?tab=integrations" } },
  { id: "connector", label: "Connector", description: "Hardware-bound or store connectors.", icon: "Cable", group: "Integrations", needsDashboard: true, cta: { type: "navigate", path: "/marketplace" } },
  { id: "llm-provider", label: "LLM provider", description: "Connect subscription or API LLM providers.", icon: "Sparkles", group: "Integrations", cta: { type: "open_panel", tab: "platform-vault" } },
  { id: "oauth-provider", label: "OAuth provider", description: "Additional OAuth subscription providers.", icon: "KeyRound", group: "Integrations", needsDashboard: true, cta: { type: "open_panel", tab: "platform-vault" } },
  { id: "bridge-connection", label: "Bridge connection", description: "Hub / Bridge instance attach.", icon: "Server", group: "Integrations", systemOnly: true, needsDashboard: true, cta: { type: "none" } },
  { id: "github", label: "GitHub", description: "GitHub App for Projects, git, releases, Support.", icon: "Github", group: "Integrations", cta: { type: "navigate", path: "/vault?tab=integrations" } },
  { id: "payment-rail", label: "Payment rail", description: "Stripe Connect and payout rails.", icon: "CreditCard", group: "Integrations", cta: { type: "navigate", path: "/vault?tab=marketplace" } },
  { id: "network-peer", label: "Network peer", description: "Remote bridge / federation peer.", icon: "Network", group: "Integrations", cta: { type: "navigate", path: "/settings/shared" } },
  { id: "marketplace-link", label: "Marketplace link", description: "Link Marketplace packs to this instance.", icon: "Store", group: "Marketplace", cta: { type: "navigate", path: "/marketplace" } },
  { id: "seller-link", label: "Seller link", description: "Connect seller profile and listings.", icon: "BadgeDollarSign", group: "Marketplace", cta: { type: "navigate", path: "/marketplace?tab=seller" } },
  { id: "inference-endpoint", label: "Inference endpoint", description: "Attach local or remote inference endpoints.", icon: "Cpu", group: "Marketplace", needsDashboard: true, cta: { type: "open_chat" } },
  { id: "vault-key", label: "Vault key", description: "Connect a Personal or Agent Vault secret.", icon: "KeyRound", group: "Vault", cta: { type: "navigate", path: "/vault?tab=secrets" } },
  { id: "platform-vault-key", label: "Platform Vault key", description: "Cloud / Inference platform secrets.", icon: "KeyRound", group: "Vault", systemOnly: true, cta: { type: "open_panel", tab: "platform-vault" } },
  { id: "secret-grant", label: "Secret grant", description: "Grant secret access across scopes.", icon: "KeySquare", group: "Vault", needsDashboard: true, cta: { type: "none" } },
  { id: "finance-connection", label: "Finance connection", description: "Bank holdings and account connections.", icon: "Landmark", group: "Vault", cta: { type: "navigate", path: "/vault?tab=wallets" } },
  { id: "wallet-link", label: "Wallet link", description: "Link a wallet under Vault or Bank.", icon: "Wallet", group: "Vault", cta: { type: "navigate", path: "/vault?tab=wallets" } },
] as const satisfies readonly GraphActionMenuItem[];

export type GraphConnectKind =
  (typeof GRAPH_ACTION_CONNECT_ITEMS)[number]["id"];

export function labelForConnectKind(kind: GraphConnectKind): string {
  return GRAPH_ACTION_CONNECT_ITEMS.find((k) => k.id === kind)?.label ?? kind;
}

/** @deprecated Prefer GRAPH_ACTION_CONNECT_ITEMS. */
export const GRAPH_CONNECT_KINDS = GRAPH_ACTION_CONNECT_ITEMS.map((k) => ({
  id: k.id,
  label: k.label,
})) as ReadonlyArray<{ id: GraphConnectKind; label: string }>;

// ─── Monitor ────────────────────────────────────────────────────────────────
// IDs match GraphMonitorKindMenu / ChatGraphCanvas selectMonitorKind.

export const GRAPH_ACTION_MONITOR_ITEMS = [
  { id: "notifications", label: "Notifications", description: "Platform alerts including signed-release availability.", icon: "Bell", group: "Alerts", cta: { type: "open_panel", tab: "notifications" } },
  { id: "attention", label: "Attention", description: "Graph nodes with open mission attention.", icon: "Eye", group: "Alerts", cta: { type: "none" } },
  { id: "system-notices", label: "System notices", description: "Graph system notice bar.", icon: "Megaphone", group: "Alerts", needsDashboard: true, cta: { type: "open_panel", tab: "notifications" } },
  { id: "autonomous-reviews", label: "Autonomous reviews", description: "Autonomous runner review / failure queue.", icon: "Bot", group: "Alerts", needsDashboard: true, cta: { type: "open_panel", tab: "projects" } },
  { id: "inference-status", label: "Inference status", description: "Live model runtime status.", icon: "Activity", group: "Runtime", cta: { type: "open_chat" } },
  { id: "prompt-queue", label: "Prompt queue", description: "Pending and running prompt jobs.", icon: "ListTodo", group: "Runtime", cta: { type: "open_chat" } },
  { id: "runtime-health", label: "Runtime health", description: "Model runtime health check.", icon: "HeartPulse", group: "Runtime", cta: { type: "open_chat" } },
  { id: "runtime-logs", label: "Runtime logs", description: "Recent model runtime log lines.", icon: "ScrollText", group: "Runtime", cta: { type: "open_chat" } },
  { id: "platform-health", label: "Platform health", description: "Bridge /api/health.", icon: "Server", group: "Runtime", systemOnly: true, cta: { type: "none" } },
  { id: "embedding-engine", label: "Embedding engine", description: "Embeddings / RAG engine status.", icon: "Brain", group: "Runtime", systemOnly: true, needsDashboard: true, cta: { type: "navigate", path: "/agents?section=activity" } },
  { id: "missions", label: "Missions", description: "Graph attention missions on You.", icon: "Trophy", group: "Graph", cta: { type: "none" } },
  { id: "leaderboard", label: "Leaderboard", description: "Top 10 Board points leaderboard.", icon: "Medal", group: "Graph", cta: { type: "none" } },
  { id: "ether-chat", label: "Ether chat", description: "Open the Graph ether composer.", icon: "MessageCircle", group: "Graph", cta: { type: "open_chat" } },
  { id: "agent-activity", label: "Agent activity", description: "Agents activity section.", icon: "Activity", group: "Activity", cta: { type: "navigate", path: "/agents?section=activity" } },
  { id: "bank-activity", label: "Bank activity", description: "Bank ledger activity.", icon: "Landmark", group: "Activity", cta: { type: "open_panel", tab: "bank" } },
  { id: "calendar-activity", label: "Calendar activity", description: "Calendar feed and upcoming events.", icon: "CalendarDays", group: "Activity", cta: { type: "open_panel", tab: "calendar" } },
  { id: "automation-activity", label: "Automation activity", description: "Workflow / hook / schedule activity.", icon: "Workflow", group: "Activity", needsDashboard: true, cta: { type: "open_panel", tab: "projects" } },
  { id: "vault-activity", label: "Vault activity", description: "Recent vault connect and secret changes.", icon: "Vault", group: "Activity", needsDashboard: true, cta: { type: "open_panel", tab: "vault" } },
  { id: "support", label: "Support", description: "Support ticket queue.", icon: "LifeBuoy", group: "Activity", cta: { type: "open_panel", tab: "support" } },
  { id: "release-submissions", label: "Release submissions", description: "GitHub Releases draft/publish status.", icon: "Rocket", group: "Activity", cta: { type: "navigate", path: "/releases" } },
  { id: "training-jobs", label: "Training jobs", description: "Model training job monitor.", icon: "GraduationCap", group: "Jobs", needsDashboard: true, cta: { type: "none" } },
  { id: "sync-jobs", label: "Sync jobs", description: "Background sync job monitor.", icon: "RefreshCw", group: "Jobs", needsDashboard: true, cta: { type: "none" } },
  { id: "webhook-delivery", label: "Webhook delivery", description: "Outbound webhook delivery log.", icon: "Webhook", group: "Jobs", needsDashboard: true, cta: { type: "none" } },
] as const satisfies readonly GraphActionMenuItem[];

export type GraphMonitorKind =
  (typeof GRAPH_ACTION_MONITOR_ITEMS)[number]["id"];

export function labelForMonitorKind(kind: GraphMonitorKind): string {
  return GRAPH_ACTION_MONITOR_ITEMS.find((k) => k.id === kind)?.label ?? kind;
}

/** @deprecated Prefer GRAPH_ACTION_MONITOR_ITEMS. */
export const GRAPH_MONITOR_KINDS = GRAPH_ACTION_MONITOR_ITEMS.map((k) => ({
  id: k.id,
  label: k.label,
  group: k.group,
})) as ReadonlyArray<{ id: GraphMonitorKind; label: string; group?: string }>;

// ─── Execute ────────────────────────────────────────────────────────────────

export const GRAPH_ACTION_EXECUTE_ITEMS = [
  {
    id: "run-chat-agent",
    label: "Run chat (Agent mode)",
    description: "Send with full tool access (default).",
    icon: "Play",
    group: "Chat",
    cta: { type: "open_chat" },
  },
  {
    id: "run-chat-plan",
    label: "Run chat (Plan mode)",
    description: "Structured planning; confirm before destructive tools.",
    icon: "ListTodo",
    group: "Chat",
    cta: { type: "open_chat" },
  },
  {
    id: "run-workflow",
    label: "Run workflow",
    description: "Execute a named Automations workflow.",
    icon: "GitBranch",
    group: "Automations",
    needsDashboard: true,
    cta: { type: "select_kind" },
  },
  {
    id: "run-schedule-now",
    label: "Run schedule now",
    description: "Fire a schedule immediately.",
    icon: "Clock",
    group: "Automations",
    needsDashboard: true,
    cta: { type: "select_kind" },
  },
  {
    id: "trigger-hook",
    label: "Trigger hook",
    description: "Emit or replay a platform event for a hook.",
    icon: "Webhook",
    group: "Automations",
    needsDashboard: true,
    cta: { type: "select_kind" },
  },
  {
    id: "autonomous-task-runner",
    label: "Autonomous task runner",
    description: "Process auto-tagged kanban backlog.",
    icon: "Bot",
    group: "Automations",
    needsDashboard: true,
    cta: { type: "navigate", path: "/tasks" },
  },
  {
    id: "coding-terminal",
    label: "Coding terminal",
    description: "Run shell/git helpers on the coding root.",
    icon: "Terminal",
    group: "Coding",
    cta: { type: "navigate", path: "/coding" },
  },
  {
    id: "release-prepare",
    label: "Release prepare",
    description: "Prepare a GitHub Releases draft via Connect.",
    icon: "Rocket",
    group: "Coding",
    needsDashboard: true,
    cta: { type: "navigate", path: "/releases" },
  },
  {
    id: "release-publish",
    label: "Release publish",
    description: "Publish a prepared release (authority gated).",
    icon: "Upload",
    group: "Coding",
    needsDashboard: true,
    cta: { type: "navigate", path: "/releases" },
  },
  {
    id: "scaffold-plugin",
    label: "Scaffold plugin",
    description: "scaffold_plugin → build_plugin → install_plugin path.",
    icon: "Puzzle",
    group: "Marketplace",
    needsDashboard: true,
    cta: { type: "navigate", path: "/marketplace?tab=local" },
  },
  {
    id: "install-pack",
    label: "Install pack",
    description: "Install from Official, Local, or Community Marketplace.",
    icon: "Download",
    group: "Marketplace",
    cta: { type: "navigate", path: "/marketplace" },
  },
  {
    id: "slash-command",
    label: "Slash command",
    description: "Run a /command in the active chat.",
    icon: "Slash",
    group: "Chat",
    cta: { type: "open_chat" },
  },
  {
    id: "claim-mission",
    label: "Claim Graph mission",
    description: "Complete an open Graph attention mission for points.",
    icon: "Trophy",
    group: "Graph",
    needsDashboard: true,
    cta: { type: "none" },
  },
  {
    id: "support-promote-task",
    label: "Promote ticket to task",
    description: "Create follow-up kanban work from Support.",
    icon: "LifeBuoy",
    group: "Social",
    cta: { type: "navigate", path: "/support" },
  },
  {
    id: "run-agent",
    label: "Run specialized agent",
    description: "Open chat targeting Research, Ops, Builder, or peers.",
    icon: "Bot",
    group: "Agents",
    cta: { type: "open_chat" },
  },
  {
    id: "run-automation",
    label: "Run automation",
    description: "Open Automations to pick a workflow, schedule, or hook.",
    icon: "Workflow",
    group: "Automations",
    cta: { type: "navigate", path: "/agents?section=workflows" },
  },
  {
    id: "run-pipeline",
    label: "Run pipeline",
    description: "Open the Agents pipeline runner.",
    icon: "GitBranch",
    group: "Agents",
    cta: { type: "navigate", path: "/agents?section=pipeline" },
  },
  {
    id: "invoke-tool",
    label: "Invoke tool",
    description: "Open Knowledge tools to run an allow-listed tool.",
    icon: "Wrench",
    group: "Tools",
    cta: { type: "open_panel", tab: "knowledge", subTab: "tools" },
  },
  {
    id: "run-job",
    label: "Run job",
    description: "Queue or replay a background job.",
    icon: "Cog",
    group: "Jobs",
    needsDashboard: true,
    cta: { type: "select_kind" },
  },
  {
    id: "sync-missions",
    label: "Sync missions",
    description: "Refresh Graph mission awards and scoreboard.",
    icon: "RefreshCw",
    group: "Graph",
    cta: { type: "none" },
  },
] as const satisfies readonly GraphActionMenuItem[];

export type GraphExecuteKind =
  (typeof GRAPH_ACTION_EXECUTE_ITEMS)[number]["id"];

export function labelForExecuteKind(kind: GraphExecuteKind): string {
  return (
    GRAPH_ACTION_EXECUTE_ITEMS.find((k) => k.id === kind)?.label ?? kind
  );
}

/** @deprecated Prefer GRAPH_ACTION_EXECUTE_ITEMS; kept for menu imports. */
export const GRAPH_EXECUTE_KINDS = GRAPH_ACTION_EXECUTE_ITEMS.map((k) => ({
  id: k.id,
  label: k.label,
})) as ReadonlyArray<{ id: GraphExecuteKind; label: string }>;

// ─── Validate ───────────────────────────────────────────────────────────────
// Checks and audits: live Bridge calls where available, navigate/stub for the rest.

export const GRAPH_ACTION_VALIDATE_ITEMS = [
  {
    id: "schema-kernel",
    label: "Schema / kernel",
    description: "Live ObjectType registry load (full CLI audit stays in repo).",
    icon: "Database",
    group: "Core",
    systemOnly: true,
    cta: { type: "none" },
  },
  {
    id: "objecttype-schema",
    label: "ObjectType registry",
    description: "Count declared ObjectTypes from /object-types.",
    icon: "Table",
    group: "Core",
    systemOnly: true,
    cta: { type: "navigate", path: "/records" },
  },
  {
    id: "kernel-parity",
    label: "Kernel parity",
    description: "npm run audit:kernel:parity (CLI).",
    icon: "GitCompare",
    group: "Audits",
    systemOnly: true,
    needsDashboard: true,
    cta: { type: "none" },
  },
  {
    id: "oss-audit",
    label: "OSS audit",
    description: "npm run audit:oss (CLI).",
    icon: "ScanSearch",
    group: "Audits",
    systemOnly: true,
    needsDashboard: true,
    cta: { type: "none" },
  },
  {
    id: "plugin-data-plane",
    label: "Plugin data plane",
    description: "npm run audit:plugin-data-plane (CLI).",
    icon: "Plug",
    group: "Audits",
    systemOnly: true,
    needsDashboard: true,
    cta: { type: "none" },
  },
  {
    id: "cursor-attribution",
    label: "Cursor attribution",
    description: "npm run audit:cursor-attribution (CLI).",
    icon: "BadgeCheck",
    group: "Audits",
    systemOnly: true,
    needsDashboard: true,
    cta: { type: "none" },
  },
  {
    id: "ai-tool-parity",
    label: "AI tool parity",
    description: "Static vs generated tool parity gate.",
    icon: "Bot",
    group: "Audits",
    systemOnly: true,
    needsDashboard: true,
    cta: { type: "none" },
  },
  {
    id: "release-verify",
    label: "Release verify",
    description: "npm run release:verify (CLI).",
    icon: "PackageCheck",
    group: "Audits",
    systemOnly: true,
    needsDashboard: true,
    cta: { type: "none" },
  },
  {
    id: "test-gate",
    label: "Test gate",
    description: "npm run test:gate (CLI).",
    icon: "TestTube",
    group: "Audits",
    systemOnly: true,
    needsDashboard: true,
    cta: { type: "none" },
  },
  {
    id: "bridge-health",
    label: "Bridge health",
    description: "GET /api/health.",
    icon: "HeartPulse",
    group: "Runtime",
    systemOnly: true,
    cta: { type: "none" },
  },
  {
    id: "health-probes",
    label: "Health probes",
    description: "Plugin-registered health probes (dashboard pending).",
    icon: "Activity",
    group: "Runtime",
    systemOnly: true,
    needsDashboard: true,
    cta: { type: "none" },
  },
  {
    id: "embeddings-ready",
    label: "Embeddings / memory",
    description: "RAG / memory index availability.",
    icon: "Brain",
    group: "Runtime",
    systemOnly: true,
    needsDashboard: true,
    cta: { type: "navigate", path: "/settings/admin" },
  },
  {
    id: "federation",
    label: "Federation / Shared",
    description: "Shared network and Tailscale federation status.",
    icon: "Share2",
    group: "Runtime",
    systemOnly: true,
    cta: { type: "navigate", path: "/settings/shared" },
  },
  {
    id: "mission-verify",
    label: "Mission verify",
    description: "Sync Graph mission predicates and auto-awards.",
    icon: "Trophy",
    group: "Graph",
    cta: { type: "none" },
  },
  {
    id: "graph-integrity",
    label: "Graph integrity",
    description: "Projection nodes/edges consistency check.",
    icon: "Network",
    group: "Graph",
    cta: { type: "none" },
  },
  {
    id: "unlocks",
    label: "Unlock entitlements",
    description: "Chat unlock tutorial / purchase entitlements.",
    icon: "Unlock",
    group: "Graph",
    systemOnly: true,
    cta: { type: "none" },
  },
  {
    id: "rules-lint",
    label: "Rules lint",
    description: "Load AI rules and report enabled count.",
    icon: "ScrollText",
    group: "Policy",
    cta: { type: "none" },
  },
  {
    id: "permissions",
    label: "Permissions",
    description: "Agent and coding permission surfaces.",
    icon: "Lock",
    group: "Policy",
    systemOnly: true,
    cta: { type: "navigate", path: "/agents" },
  },
  {
    id: "authority-gates",
    label: "Authority gates",
    description: "coding / spend / deploy / delete / send / agent domains.",
    icon: "ShieldCheck",
    group: "Policy",
    systemOnly: true,
    cta: { type: "navigate", path: "/settings/admin?tab=authority" },
  },
  {
    id: "tool-allowlist",
    label: "Tool allowlists",
    description: "Confirm tools Hub will execute for each agent.",
    icon: "Wrench",
    group: "Policy",
    needsDashboard: true,
    cta: { type: "open_panel", tab: "knowledge", subTab: "tools" },
  },
  {
    id: "vault-secrets",
    label: "Vault secrets",
    description: "Open Agent Vault to review secret slots.",
    icon: "KeyRound",
    group: "Policy",
    cta: { type: "open_panel", tab: "vault" },
  },
  {
    id: "mfa-status",
    label: "MFA status",
    description: "Account multi-factor enrollment check.",
    icon: "Shield",
    group: "Security",
    systemOnly: true,
    needsDashboard: true,
    cta: { type: "navigate", path: "/settings/platform?tab=general" },
  },
  {
    id: "onboarding-llm-ready",
    label: "LLM readiness",
    description: "Onboarding llmReady / Cursor connected predicates.",
    icon: "Sparkles",
    group: "Surfaces",
    systemOnly: true,
    needsDashboard: true,
    cta: { type: "open_panel", tab: "platform-vault" },
  },
  {
    id: "structure-integrity",
    label: "Structure",
    description: "Departments/divisions/pages hierarchy.",
    icon: "FolderTree",
    group: "Surfaces",
    cta: { type: "navigate", path: "/structure" },
  },
  {
    id: "marketplace-catalog",
    label: "Marketplace catalog",
    description: "Official and installed Marketplace listings.",
    icon: "Store",
    group: "Surfaces",
    cta: { type: "navigate", path: "/marketplace" },
  },
  {
    id: "release-near-proof",
    label: "Release Near proof",
    description: "Vault Connect + draft + status validation for Releases.",
    icon: "Rocket",
    group: "Surfaces",
    needsDashboard: true,
    cta: { type: "navigate", path: "/releases" },
  },
  {
    id: "signed-updates",
    label: "Signed updates",
    description: "Verify release signatures before Admin apply.",
    icon: "BadgeCheck",
    group: "Surfaces",
    systemOnly: true,
    cta: { type: "navigate", path: "/settings/admin" },
  },
  {
    id: "workspace-template",
    label: "Workspace template",
    description: "Validate template defaults for new tenants.",
    icon: "LayoutTemplate",
    group: "Surfaces",
    systemOnly: true,
    cta: { type: "navigate", path: "/settings/admin?tab=template" },
  },
  {
    id: "reflection-review",
    label: "Reflection review",
    description: "Approve or reject queued knowledge proposals.",
    icon: "Lightbulb",
    group: "Surfaces",
    needsDashboard: true,
    cta: { type: "open_panel", tab: "knowledge", subTab: "reflection" },
  },
  {
    id: "support-verify",
    label: "Support routing",
    description: "Confirm ticket targets and GitHub App availability.",
    icon: "LifeBuoy",
    group: "Surfaces",
    cta: { type: "navigate", path: "/support" },
  },
] as const satisfies readonly GraphActionMenuItem[];

export type GraphValidateKind =
  (typeof GRAPH_ACTION_VALIDATE_ITEMS)[number]["id"];

export function labelForValidateKind(kind: GraphValidateKind): string {
  return (
    GRAPH_ACTION_VALIDATE_ITEMS.find((k) => k.id === kind)?.label ?? kind
  );
}

/** @deprecated Prefer GRAPH_ACTION_VALIDATE_ITEMS; kept for menu imports. */
export const GRAPH_VALIDATE_KINDS = GRAPH_ACTION_VALIDATE_ITEMS.map((k) => ({
  id: k.id,
  label: k.label,
})) as ReadonlyArray<{ id: GraphValidateKind; label: string }>;

// ─── Govern ─────────────────────────────────────────────────────────────────
// IDs match GraphGovernKindMenu / ChatGraphCanvas selectGovernKind.

export const GRAPH_ACTION_GOVERN_ITEMS = [
  { id: "permissions", label: "Permissions", description: "Workspace and share permission scopes.", icon: "Lock", group: "Access", systemOnly: true, needsDashboard: true, cta: { type: "navigate", path: "/settings/shared" } },
  { id: "roles", label: "Roles", description: "Owner vs editor membership roles.", icon: "UserCog", group: "Access", systemOnly: true, needsDashboard: true, cta: { type: "navigate", path: "/settings/platform" } },
  { id: "share-grants", label: "Share grants", description: "Live resource grants and federation.", icon: "Share2", group: "Access", cta: { type: "navigate", path: "/settings/shared" } },
  { id: "membership", label: "Cloud membership", description: "GodMode Cloud seats and membership.", icon: "Cloud", group: "Access", systemOnly: true, cta: { type: "open_panel", tab: "platform-vault" } },
  { id: "users", label: "Users", description: "Platform user administration.", icon: "Users", group: "Access", systemOnly: true, cta: { type: "navigate", path: "/settings/admin" } },
  { id: "tool-autonomy", label: "Tool autonomy", description: "off / writes / full autonomy in chat.", icon: "Gauge", group: "Agents & tools", systemOnly: true, needsDashboard: true, cta: { type: "open_chat" } },
  { id: "auto-accept-tools", label: "Auto-accept tools", description: "Auto-accept tool call policy.", icon: "CheckCheck", group: "Agents & tools", systemOnly: true, needsDashboard: true, cta: { type: "open_chat" } },
  { id: "coding-authority", label: "Coding authority", description: "Coding domain authority gate.", icon: "Code2", group: "Agents & tools", systemOnly: true, cta: { type: "navigate", path: "/settings/admin" } },
  { id: "spend-authority", label: "Spend authority", description: "Spend domain authority gate.", icon: "Wallet", group: "Agents & tools", systemOnly: true, cta: { type: "navigate", path: "/settings/admin" } },
  { id: "deploy-authority", label: "Deploy authority", description: "Deploy domain authority gate.", icon: "Rocket", group: "Agents & tools", systemOnly: true, cta: { type: "navigate", path: "/settings/admin" } },
  { id: "delete-authority", label: "Delete authority", description: "Delete domain authority gate.", icon: "Trash2", group: "Agents & tools", systemOnly: true, cta: { type: "navigate", path: "/settings/admin" } },
  { id: "send-authority", label: "Send authority", description: "Send domain authority gate.", icon: "Send", group: "Agents & tools", systemOnly: true, cta: { type: "navigate", path: "/settings/admin" } },
  { id: "agent-pause", label: "Agent pause / kills", description: "Pause agents and kill switches.", icon: "OctagonAlert", group: "Agents & tools", systemOnly: true, needsDashboard: true, cta: { type: "navigate", path: "/settings/admin" } },
  { id: "vault-policies", label: "Vault policies", description: "Where secrets may live and who can read them.", icon: "Shield", group: "Vault & secrets", systemOnly: true, needsDashboard: true, cta: { type: "navigate", path: "/vault" } },
  { id: "agent-vault", label: "Agent Vault", description: "Per-agent secret governance.", icon: "KeyRound", group: "Vault & secrets", systemOnly: true, cta: { type: "open_panel", tab: "vault" } },
  { id: "platform-vault", label: "Platform Vault", description: "Cloud and Inference platform secrets.", icon: "KeyRound", group: "Vault & secrets", systemOnly: true, cta: { type: "open_panel", tab: "platform-vault" } },
  { id: "secrets-policy", label: "Secrets policy", description: "Secret retention and scope policy.", icon: "ScrollText", group: "Vault & secrets", systemOnly: true, needsDashboard: true, cta: { type: "open_panel", tab: "platform-vault" } },
  { id: "audit-logs", label: "Audit logs", description: "Authority and admin audit trail.", icon: "ScrollText", group: "Compliance", systemOnly: true, needsDashboard: true, cta: { type: "navigate", path: "/settings/admin" } },
  { id: "retention", label: "Retention", description: "Data retention policy.", icon: "Timer", group: "Compliance", systemOnly: true, needsDashboard: true, cta: { type: "none" } },
  { id: "observability", label: "Observability", description: "Admin observability logs.", icon: "Activity", group: "Compliance", systemOnly: true, cta: { type: "navigate", path: "/settings/admin" } },
  { id: "support", label: "Support", description: "Support queue administration.", icon: "LifeBuoy", group: "Compliance", cta: { type: "navigate", path: "/support" } },
  { id: "publish-rules", label: "Publish rules", description: "Marketplace publish rules.", icon: "BookCheck", group: "Marketplace", systemOnly: true, needsDashboard: true, cta: { type: "navigate", path: "/marketplace?tab=seller" } },
  { id: "seller-policies", label: "Seller policies", description: "Seller ToS and payout policy.", icon: "Store", group: "Marketplace", systemOnly: true, cta: { type: "navigate", path: "/marketplace?tab=seller" } },
  { id: "listing-policies", label: "Listing policies", description: "Listing moderation policy.", icon: "FileCheck", group: "Marketplace", systemOnly: true, needsDashboard: true, cta: { type: "navigate", path: "/marketplace" } },
  { id: "marketplace-fees", label: "Fees & billing", description: "Marketplace fees and billing.", icon: "BadgeDollarSign", group: "Marketplace", systemOnly: true, needsDashboard: true, cta: { type: "navigate", path: "/settings/admin" } },
  { id: "esc-menu", label: "System menu (Esc)", description: "Open the Graph Esc system menu.", icon: "Keyboard", group: "Settings", systemOnly: true, cta: { type: "none" } },
  { id: "settings", label: "Settings", description: "Account, appearance, and storage settings.", icon: "Settings", group: "Settings", systemOnly: true, cta: { type: "navigate", path: "/settings/platform" } },
  { id: "appearance", label: "Appearance", description: "Theme and appearance preferences.", icon: "Palette", group: "Settings", systemOnly: true, cta: { type: "navigate", path: "/settings/platform?tab=general" } },
  { id: "account", label: "Account & security", description: "Profile, password, and MFA.", icon: "Shield", group: "Settings", systemOnly: true, cta: { type: "navigate", path: "/settings/platform?tab=general" } },
  { id: "admin", label: "Admin console", description: "Platform Admin tabs.", icon: "ShieldCheck", group: "Settings", systemOnly: true, cta: { type: "open_panel", tab: "admin" } },
  { id: "workspace-template", label: "Workspace template", description: "Defaults for new workspaces.", icon: "LayoutTemplate", group: "Settings", systemOnly: true, cta: { type: "navigate", path: "/settings/admin?tab=template" } },
] as const satisfies readonly GraphActionMenuItem[];

export type GraphGovernKind =
  (typeof GRAPH_ACTION_GOVERN_ITEMS)[number]["id"];

export function labelForGovernKind(kind: GraphGovernKind): string {
  return GRAPH_ACTION_GOVERN_ITEMS.find((k) => k.id === kind)?.label ?? kind;
}

/** All mode → items maps for menu builders. */
export const GRAPH_ACTION_MENUS = {
  create: GRAPH_ACTION_CREATE_ITEMS,
  edit: GRAPH_ACTION_EDIT_ITEMS,
  organize: GRAPH_ACTION_ORGANIZE_ITEMS,
  connect: GRAPH_ACTION_CONNECT_ITEMS,
  monitor: GRAPH_ACTION_MONITOR_ITEMS,
  execute: GRAPH_ACTION_EXECUTE_ITEMS,
  validate: GRAPH_ACTION_VALIDATE_ITEMS,
  govern: GRAPH_ACTION_GOVERN_ITEMS,
} as const;

export type GraphActionMenus = typeof GRAPH_ACTION_MENUS;

export function graphActionItemsFor(
  mode: GraphActionModeId
): readonly GraphActionMenuItem[] {
  return GRAPH_ACTION_MENUS[mode];
}
