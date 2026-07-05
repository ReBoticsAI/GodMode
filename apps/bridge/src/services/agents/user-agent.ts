import type { AppDatabase } from "../../db.js";
import { getCoreDb, type CoreUser, type CoreUserProfile } from "../../core-db.js";
import { getAgent, updateAgent, createAgent } from "./agents-db.js";
import {
  assembleUserAgentPrompt,
  isUserAgentId,
  userAgentIdForUserId,
} from "./user-agent-prompt.js";
import { DEFAULT_REFLECTION_CONFIG } from "../reflection-config.js";
import { personalDigitalYouToolNames } from "../ai-tools-registry.js";
import { upsertRuleInDb } from "../knowledge-store.js";
import { isPersonalTenantDb } from "../tenant-kind.js";

const PERSONA_TWIN_RULE = {
  id: "persona-twin",
  description: "Digital You persona behavior",
  body: [
    "You are the user's digital twin — a private thinking partner, not the platform operator.",
    "Respond from their perspective using profile and saved memories. Be direct and honest; say when uncertain.",
    "Do not deploy playbooks, mutate workspace structure, or run coding tools unless the user explicitly expands your tool permissions.",
  ].join("\n"),
  alwaysApply: true,
  globs: [] as string[],
  departments: [] as string[],
  priority: 10,
};

function ensurePersonaTwinRule(db: AppDatabase, agentId: string): void {
  if (!isPersonalTenantDb(db)) return;
  upsertRuleInDb(db, agentId, {
    ...PERSONA_TWIN_RULE,
    enabled: true,
    status: "active",
  });
}

function personaToolAllowNeedsRepair(allow: string[] | null | undefined): boolean {
  if (allow === null || allow === undefined) return true;
  if (allow.length === 0) return true;
  return false;
}

function loadProfile(userId: string): CoreUserProfile | undefined {
  return getCoreDb()
    .prepare(`SELECT * FROM user_profiles WHERE user_id=?`)
    .get(userId) as CoreUserProfile | undefined;
}

/**
 * Display name for a user's persona ("digital twin") agent. Prefixed with
 * "Digital" so it's clearly distinct from the human user everywhere it's shown
 * (chat title, sidebar, org chart, etc.). Idempotent: never double-prefixes.
 */
export function personaAgentName(displayName: string): string {
  const name = displayName.trim() || "You";
  return /^digital\s/i.test(name) ? name : `Digital ${name}`;
}

/**
 * Robust default description for a persona ("digital twin") agent. Explains what
 * the agent is, how it learns, and its limits so the user understands the
 * feature. Users can extend this from the Agent Profile editor.
 */
export function personaAgentDescription(displayName: string): string {
  const name = personaAgentName(displayName);
  return (
    `${name} is your digital you — a private thinking partner just for you. ` +
    `Bounce ideas around, talk things through, and use it to stay focused and ` +
    `on track toward your goals. ` +
    `It learns how you think, communicate and decide over time, so it can ` +
    `reflect your own perspective back to you and help you move faster. ` +
    `It only knows what you've shared (your profile), saved memories and past ` +
    `conversations, thus it can be wrong or out of date; treat it's replies as ` +
    `a sounding board, not a final decision. ` +
    `Refine it's voice, knowledge and limits anytime from it's Agent Profile in ` +
    `Agents > Pipeline.`
  );
}

/**
 * Whether an existing persona description is still an auto-generated default
 * (so it's safe to refresh) rather than something the user has customized.
 */
function isDefaultPersonaDescription(description: string | null): boolean {
  if (!description) return true;
  const trimmed = description.trim();
  if (trimmed === "") return true;
  // Legacy: persona agents inherited the root template's description on create.
  if (trimmed === "Default platform assistant template") return true;
  // A previously-generated persona blurb (name may differ).
  if (trimmed.includes("is your digital twin — a digital representation of you"))
    return true;
  if (trimmed.includes("is your Twin, a digital representation of you"))
    return true;
  if (trimmed.includes("is your digital you — a private thinking partner"))
    return true;
  return false;
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

/** Idempotent: ensure the signed-in user's persona agent exists in this tenant DB. */
export function ensureUserAgent(
  db: AppDatabase,
  user: { id: string; display_name?: string; displayName?: string; email: string }
): void {
  const displayName = user.display_name ?? user.displayName ?? user.email.split("@")[0] ?? "You";
  const normalized = { id: user.id, display_name: displayName, email: user.email };
  const id = userAgentIdForUserId(user.id);
  const profile = loadProfile(user.id);
  const existing = getAgent(db, id);
  const memories = existing ? loadUserIdentityMemories(db, id) : [];
  const systemPrompt = assembleUserAgentPrompt(normalized, profile, memories);
  const emoji = profile?.emoji?.trim() || "👤";

  if (existing) {
    const patch: Parameters<typeof updateAgent>[2] = {
      name: personaAgentName(displayName),
      icon: emoji,
      systemPrompt,
      parentId: null,
      ...(isDefaultPersonaDescription(existing.description)
        ? { description: personaAgentDescription(displayName) }
        : {}),
    };
    if (personaToolAllowNeedsRepair(existing.toolAllow)) {
      patch.toolAllow = personalDigitalYouToolNames();
    }
    updateAgent(db, id, patch);
    ensurePersonaTwinRule(db, id);
    return;
  }

  createAgent(db, {
    id,
    name: personaAgentName(displayName),
    description: personaAgentDescription(displayName),
    icon: emoji,
    systemPrompt,
    parentId: null,
    team: "persona",
    config: {
      userPersona: true,
      userId: user.id,
      knowsUser: true,
      reflection: { ...DEFAULT_REFLECTION_CONFIG, enabled: true, mode: "approval" },
    },
    toolAllow: personalDigitalYouToolNames(),
    autoApprove: [],
  });
  ensurePersonaTwinRule(db, id);
}

/** Rebuild persona prompt after profile or memory changes. */
export function refreshUserAgentPrompt(db: AppDatabase, userId: string): void {
  const core = getCoreDb();
  const user = core.prepare(`SELECT * FROM users WHERE id=?`).get(userId) as CoreUser | undefined;
  if (!user) return;
  const id = userAgentIdForUserId(userId);
  if (!getAgent(db, id)) {
    ensureUserAgent(db, user);
    return;
  }
  const profile = loadProfile(userId);
  const memories = loadUserIdentityMemories(db, id);
  updateAgent(db, id, {
    systemPrompt: assembleUserAgentPrompt(user, profile, memories),
    name: personaAgentName(
      user.display_name?.trim() || user.email.split("@")[0] || "You"
    ),
    icon: profile?.emoji?.trim() || "👤",
  });
}

export { isUserAgentId, userAgentIdForUserId };
