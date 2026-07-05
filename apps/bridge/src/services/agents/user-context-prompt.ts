import { getCoreDb, type CoreUser, type CoreUserProfile } from "../../core-db.js";
import { getTenantOwnerUserId } from "../user-scope.js";
import type { AiAgent } from "./types.js";
import { agentKnowsUser } from "./agent-profile-prompt.js";
import { isUserAgentId } from "./user-agent-prompt.js";

function formatUserContext(
  user: CoreUser,
  profile: CoreUserProfile | undefined,
  opts: { full: boolean }
): string {
  const name = user.display_name?.trim() || user.email.split("@")[0] || "User";
  const lines: string[] = [
    "## Human user context",
    `You are assisting **${name}** (${user.email}).`,
  ];
  const add = (label: string, value: string | null | undefined) => {
    const v = value?.trim();
    if (v) lines.push(`- ${label}: ${v}`);
  };

  if (opts.full) {
    add("Headline", profile?.headline);
    add("Bio", profile?.bio);
    add("Location", profile?.location);
    add("Timezone", profile?.timezone);
    add("Company", profile?.company);
    add("Job title", profile?.job_title);
    add("Values", profile?.values);
    add("Goals", profile?.goals);
    add("Decision style", profile?.decision_style);
    add("Risk tolerance", profile?.risk_tolerance);
    add("Interests", profile?.interests);
  } else {
    add("Headline", profile?.headline);
    add("Timezone", profile?.timezone);
    if (profile?.goals?.trim()) add("Goals", profile.goals);
  }

  lines.push(
    "",
    "Respect this person's preferences and context when reasoning and responding."
  );
  return lines.join("\n");
}

/** Owner user context injected when agent.config.knowsUser is true. */
export function assembleUserContextSection(
  tenantId: string | undefined,
  agent: AiAgent
): string {
  if (!agentKnowsUser(agent)) return "";

  let userId: string | null = null;
  if (isUserAgentId(agent.id)) {
    userId = agent.id.slice("user-".length);
  } else if (tenantId) {
    userId = getTenantOwnerUserId(tenantId);
  }

  if (!userId) return "";

  const core = getCoreDb();
  const user = core.prepare(`SELECT * FROM users WHERE id=?`).get(userId) as CoreUser | undefined;
  if (!user) return "";

  const profile = core
    .prepare(`SELECT * FROM user_profiles WHERE user_id=?`)
    .get(userId) as CoreUserProfile | undefined;

  const full = isUserAgentId(agent.id) || agent.id === "intelligence";
  return formatUserContext(user, profile, { full });
}
