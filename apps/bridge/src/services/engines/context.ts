import type { AppDatabase } from "../../db.js";

/**
 * Compact description of what data is relevant to a scope (department/page).
 * Stored as JSON in `ai_context_profiles` and rendered into the platform
 * section of the assembled prompt for the resolving department agent.
 */
export interface ContextProfile {
  description: string;
  endpoints: string[];
  mentionSources: string[];
  widgets: string[];
}

export type ContextScopeType = "department" | "division" | "page";

/** Sensible default endpoints/widgets for known built-in departments. */
const DEFAULTS_BY_DEPARTMENT: Record<string, Partial<ContextProfile>> = {
  trading: {
    endpoints: [
      "/api/playbooks",
      "/api/positions",
      "/api/sc/account",
      "/api/sc/trade-stats",
      "/api/risk/evaluate",
      "/api/trading-plan",
    ],
    mentionSources: ["playbooks", "positions", "trading-plan", "journal"],
    widgets: ["positions", "playbook-status", "risk", "account"],
  },
  investments: {
    endpoints: ["/api/financial", "/api/holdings"],
    mentionSources: ["holdings", "accounts"],
    widgets: ["holdings", "allocation"],
  },
  ecommerce: {
    endpoints: ["/api/financial"],
    mentionSources: ["orders", "payouts"],
    widgets: ["orders", "revenue"],
  },
};

export function buildDefaultProfile(
  departmentId: string,
  label: string,
  domain: string
): ContextProfile {
  const overrides = DEFAULTS_BY_DEPARTMENT[departmentId] ?? {};
  return {
    description: `The ${label} department covers ${domain}.`,
    endpoints: overrides.endpoints ?? [],
    mentionSources: overrides.mentionSources ?? [],
    widgets: overrides.widgets ?? [],
  };
}

export function getContextProfile(
  db: AppDatabase,
  scopeType: ContextScopeType,
  scopeId: string
): ContextProfile | null {
  const row = db
    .prepare(
      `SELECT profile_json FROM ai_context_profiles WHERE scope_type = ? AND scope_id = ?`
    )
    .get(scopeType, scopeId) as { profile_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.profile_json) as ContextProfile;
  } catch {
    return null;
  }
}

export function setContextProfile(
  db: AppDatabase,
  scopeType: ContextScopeType,
  scopeId: string,
  profile: ContextProfile
): void {
  db.prepare(
    `INSERT INTO ai_context_profiles (scope_type, scope_id, profile_json, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(scope_type, scope_id)
     DO UPDATE SET profile_json = excluded.profile_json, updated_at = datetime('now')`
  ).run(scopeType, scopeId, JSON.stringify(profile));
}

/** Compact, prompt-friendly rendering. Returns "" when nothing useful. */
export function renderContextProfile(profile: ContextProfile): string {
  const lines: string[] = [];
  if (profile.description) lines.push(profile.description);
  if (profile.endpoints.length) {
    lines.push(`Relevant data endpoints: ${profile.endpoints.join(", ")}`);
  }
  if (profile.mentionSources.length) {
    lines.push(`Mentionable sources: ${profile.mentionSources.join(", ")}`);
  }
  if (profile.widgets.length) {
    lines.push(`Relevant widgets: ${profile.widgets.join(", ")}`);
  }
  if (lines.length === 0) return "";
  return "--- Department context profile ---\n" + lines.join("\n");
}
