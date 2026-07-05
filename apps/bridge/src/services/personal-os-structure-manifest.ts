/** Read-only manifest for new hub tenant bootstrap (structure intentionally empty). */

export interface WorkspaceTemplateNode {
  id: string;
  label: string;
  icon: string;
  segment?: string;
  kind: string;
  children?: WorkspaceTemplateNode[];
}

/** New tenants start with no departments — they create structure via Intelligence. */
export const PERSONAL_OS_WORKSPACE_TEMPLATE: WorkspaceTemplateNode | null = null;

/** Global sidebar pages every tenant gets (not stored in structure_nodes). */
export const PERSONAL_OS_SIDEBAR_PAGES = [
  "Home (/home)",
  "Notifications",
  "Calendar",
  "Tasks",
  "Bank",
  "Vault",
  "Support",
  "Wiki",
  "Structure (editors only)",
  "Shared (empty until someone shares with you)",
  "Marketplace",
] as const;

/** Agents created on tenant provision (tenant SQLite). */
export const PERSONAL_OS_SEEDED_AGENTS = [
  { id: "intelligence", label: "Intelligence", note: "Platform companion" },
  { id: "user-agent", label: "Digital You", note: "Created on first login" },
] as const;

export const PERSONAL_OS_WELCOME_WIKI = {
  slug: "welcome",
  title: "Welcome to GodMode",
  space: "onboarding",
} as const;

export const PERSONAL_OS_BOOTSTRAP_NOTE =
  "New hub signups start with an empty structure tree. Personal sidebar pages, agents, and the welcome wiki are provisioned automatically. " +
  "Users create departments and pages by talking to Intelligence (or via Structure once they have content). " +
  "Share grants from other users are not part of this template — they appear under Shared only.";

/** Bootstrap rule ids imported from apps/bridge/data/ai/rules-bootstrap/ */
export const PERSONAL_BOOTSTRAP_RULE_IDS = [
  "godmode-personal",
  "platform-navigation",
  "platform-actions",
  "platform-builder-tiers",
  "platform-plugins",
  "ui-shadcn",
] as const;

/** Bootstrap skill ids for personal Intelligence */
export const PERSONAL_BOOTSTRAP_SKILL_IDS = [
  "platform-workspace",
  "platform-extension",
  "plugin-authoring",
  "platform-self-loop",
  "shadcn-ui",
] as const;

/** Lazy defaults — tool lists come from ai-tools-registry at call time (avoids circular import). */
export function getPersonalIntelligenceDefaults() {
  return {
    ruleIds: [...PERSONAL_BOOTSTRAP_RULE_IDS],
    skillIds: [...PERSONAL_BOOTSTRAP_SKILL_IDS],
    harness: "personal" as const,
  };
}

export function getPersonalOsBootstrapManifest() {
  return {
    structure: PERSONAL_OS_WORKSPACE_TEMPLATE,
    sidebarPages: [...PERSONAL_OS_SIDEBAR_PAGES],
    agents: [...PERSONAL_OS_SEEDED_AGENTS],
    welcomeWiki: PERSONAL_OS_WELCOME_WIKI,
    bootstrapNote: PERSONAL_OS_BOOTSTRAP_NOTE,
    intelligenceDefaults: getPersonalIntelligenceDefaults(),
    editable: false,
    source: "code" as const,
  };
}
