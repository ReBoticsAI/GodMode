/** Active tenant id persisted in the browser. */
export const TENANT_STORAGE_KEY = "godmode_active_tenant";
export const LEGACY_TENANT_STORAGE_KEY = "money_active_tenant";

export function readTenantId(): string | null {
  if (typeof localStorage === "undefined") return null;
  return (
    localStorage.getItem(TENANT_STORAGE_KEY) ??
    localStorage.getItem(LEGACY_TENANT_STORAGE_KEY)
  );
}

export function writeTenantId(tenantId: string): void {
  localStorage.setItem(TENANT_STORAGE_KEY, tenantId);
  localStorage.removeItem(LEGACY_TENANT_STORAGE_KEY);
}

/** Read a localStorage key, falling back to a legacy name. Writes use the new key only. */
export function readStorageKey(newKey: string, legacyKey?: string): string | null {
  if (typeof localStorage === "undefined") return null;
  const value = localStorage.getItem(newKey);
  if (value != null) return value;
  if (legacyKey) return localStorage.getItem(legacyKey);
  return null;
}

export function writeStorageKey(newKey: string, value: string, legacyKey?: string): void {
  localStorage.setItem(newKey, value);
  if (legacyKey) localStorage.removeItem(legacyKey);
}

/** GodMode Intelligence UI layout keys (migrated from moneyai.*). */
export const COMPOSER_WIDTH_KEY = "godmode.composerWidth";
export const PANEL_HEIGHT_KEY = "godmode.panelHeight";
export const PANEL_X_KEY = "godmode.panelX";
export const PANEL_Y_KEY = "godmode.panelY";
export const PANEL_TAB_KEY = "godmode.panelTab";
export const AGENTS_SECTION_KEY = "godmode.agentsSection";
export const ACTIVE_AGENT_KEY = "godmode.activeAgentId";
export const LEGACY_AGENTS_MODE_KEY = "godmode.agents.mode";

export const LEGACY_COMPOSER_WIDTH_KEY = "moneyai.composerWidth";
export const LEGACY_PANEL_HEIGHT_KEY = "moneyai.panelHeight";
export const LEGACY_PANEL_X_KEY = "moneyai.panelX";
export const LEGACY_PANEL_Y_KEY = "moneyai.panelY";
export const LEGACY_PANEL_TAB_KEY = "moneyai.panelTab";
export const LEGACY_AGENTS_SECTION_KEY = "moneyai.agentsSection";
export const LEGACY_ACTIVE_AGENT_KEY = "moneyai.activeAgentId";
export const LEGACY_AGENTS_MODE_KEY_OLD = "moneyai.agents.mode";

export const CALENDAR_VIEW_KEY = "godmode_calendar_view";
export const LEGACY_CALENDAR_VIEW_KEY = "money_calendar_view";

export const BUILDER_POSITIONS_KEY = "godmode.builder.positions";
export const LEGACY_BUILDER_POSITIONS_KEY = "moneyai.builder.positions";

/** When true, confirm-gated agent tools auto-approve for the session (kill-switches still prompt). */
export const AUTO_ACCEPT_TOOLS_KEY = "godmode.autoAcceptTools";
export const CHAT_MODE_KEY = "godmode.chatMode";
export const TOOL_AUTONOMY_KEY = "godmode.toolAutonomy";

/** HttpOnly cookie fallback for dev / embedded browsers that drop Set-Cookie on fetch. */
export const SESSION_TOKEN_KEY = "godmode_session_token";
export const LEGACY_SESSION_TOKEN_KEY = "money_session_token";

export function readSessionToken(): string | null {
  return readStorageKey(SESSION_TOKEN_KEY, LEGACY_SESSION_TOKEN_KEY);
}

export function writeSessionToken(token: string): void {
  writeStorageKey(SESSION_TOKEN_KEY, token, LEGACY_SESSION_TOKEN_KEY);
}

export function clearSessionToken(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(SESSION_TOKEN_KEY);
  localStorage.removeItem(LEGACY_SESSION_TOKEN_KEY);
}

export function clearActiveTenant(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(TENANT_STORAGE_KEY);
  localStorage.removeItem(LEGACY_TENANT_STORAGE_KEY);
}

export const ONBOARDING_COMPLETED_KEY = "godmode.onboarding.completed";

export function readOnboardingCompleted(): boolean {
  return readStorageKey(ONBOARDING_COMPLETED_KEY) === "1";
}

export function writeOnboardingCompleted(): void {
  writeStorageKey(ONBOARDING_COMPLETED_KEY, "1");
}

export function readMigratedKey(newKey: string, legacyKey: string): string | null {
  return readStorageKey(newKey, legacyKey);
}

export function writeMigratedKey(
  newKey: string,
  legacyKey: string,
  value: string
): void {
  writeStorageKey(newKey, value, legacyKey);
}
