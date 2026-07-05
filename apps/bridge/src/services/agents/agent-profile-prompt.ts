import type { AiAgent } from "./types.js";
import { assembleUserAgentPrompt, isUserAgentId } from "./user-agent-prompt.js";
import { getCoreDb, type CoreUser, type CoreUserProfile } from "../../core-db.js";
import type { AppDatabase } from "../../db.js";

export interface AgentTypedProfile {
  // Agent-specific fields
  purpose?: string | null;
  domain?: string | null;
  mandate?: string | null;
  escalatesTo?: string | null;
  notes?: string | null;
  // Shared with UserProfile (Agents & Users symmetry)
  headline?: string | null;
  bio?: string | null;
  location?: string | null;
  timezone?: string | null;
  languages?: string | null;
  interests?: string | null;
  values?: string | null;
  goals?: string | null;
  personalityNotes?: string | null;
  decisionStyle?: string | null;
  riskTolerance?: string | null;
  communicationStyle?: string | null;
}

export function readAgentTypedProfile(agent: AiAgent): AgentTypedProfile {
  const raw = agent.config?.profile as Partial<AgentTypedProfile> | undefined;
  return {
    purpose: raw?.purpose ?? null,
    domain: raw?.domain ?? null,
    mandate: raw?.mandate ?? null,
    escalatesTo: raw?.escalatesTo ?? null,
    notes: raw?.notes ?? null,
    headline: raw?.headline ?? null,
    bio: raw?.bio ?? null,
    location: raw?.location ?? null,
    timezone: raw?.timezone ?? null,
    languages: raw?.languages ?? null,
    interests: raw?.interests ?? null,
    values: raw?.values ?? null,
    goals: raw?.goals ?? null,
    personalityNotes: raw?.personalityNotes ?? null,
    decisionStyle: raw?.decisionStyle ?? null,
    riskTolerance: raw?.riskTolerance ?? null,
    communicationStyle: raw?.communicationStyle ?? null,
  };
}

function loadCoreUserProfile(userId: string): {
  user: CoreUser;
  profile: CoreUserProfile | undefined;
} | null {
  const core = getCoreDb();
  const user = core.prepare(`SELECT * FROM users WHERE id=?`).get(userId) as CoreUser | undefined;
  if (!user) return null;
  const profile = core
    .prepare(`SELECT * FROM user_profiles WHERE user_id=?`)
    .get(userId) as CoreUserProfile | undefined;
  return { user, profile };
}

function loadUserIdentityMemories(db: AppDatabase, agentId: string): Array<{ text: string }> {
  try {
    return db
      .prepare(
        `SELECT text FROM ai_memories
         WHERE agent_id=? AND status='active' AND category='user_identity'
         ORDER BY updated_at DESC LIMIT 24`
      )
      .all(agentId) as Array<{ text: string }>;
  } catch {
    return [];
  }
}

/** Assembled profile section for prompt flow (feeds base/system prompt). */
export function assembleAgentProfileSection(
  db: AppDatabase,
  agent: AiAgent
): string {
  if (isUserAgentId(agent.id)) {
    const userId = agent.id.slice("user-".length);
    const loaded = loadCoreUserProfile(userId);
    if (!loaded) return "";
    const memories = loadUserIdentityMemories(db, agent.id);
    return assembleUserAgentPrompt(loaded.user, loaded.profile, memories);
  }

  const p = readAgentTypedProfile(agent);
  const lines: string[] = [`## Agent profile: ${agent.name}`];
  const add = (label: string, value: string | null | undefined) => {
    const v = value?.trim();
    if (v) lines.push(`- **${label}:** ${v}`);
  };
  add("Purpose", p.purpose);
  add("Domain", p.domain);
  add("Mandate", p.mandate);
  add("Headline", p.headline);
  add("Bio", p.bio);
  add("Location", p.location);
  add("Timezone", p.timezone);
  add("Languages", p.languages);
  add("Interests", p.interests);
  add("Values", p.values);
  add("Goals", p.goals);
  add("Personality notes", p.personalityNotes);
  add("Decision style", p.decisionStyle);
  add("Risk tolerance", p.riskTolerance);
  add("Communication style", p.communicationStyle);
  add("Escalates to", p.escalatesTo);
  if (p.notes?.trim()) {
    lines.push("", p.notes.trim());
  }
  if (agent.description?.trim()) {
    lines.push("", agent.description.trim());
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

export function agentKnowsUser(agent: AiAgent): boolean {
  if (typeof agent.config?.knowsUser === "boolean") return agent.config.knowsUser;
  if (isUserAgentId(agent.id) || agent.id === "intelligence") return true;
  return false;
}

export function defaultKnowsUserForAgent(agentId: string): boolean {
  return isUserAgentId(agentId) || agentId === "intelligence";
}
