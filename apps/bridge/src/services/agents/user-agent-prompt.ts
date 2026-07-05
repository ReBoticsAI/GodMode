import type { CoreUser, CoreUserProfile } from "../../core-db.js";

export interface UserAgentMemory {
  text: string;
  category?: string | null;
}

/** Build the system prompt for a user's persona agent from profile + memories. */
export function assembleUserAgentPrompt(
  user: Pick<CoreUser, "display_name" | "email">,
  profile: Partial<CoreUserProfile> | null | undefined,
  memories: UserAgentMemory[] = []
): string {
  const name = user.display_name?.trim() || user.email.split("@")[0] || "User";
  const lines: string[] = [
    `You are a digital twin of ${name}. Respond from ${name}'s perspective — their values, goals, communication style, and lived context.`,
    `When uncertain, say so honestly rather than inventing preferences.`,
    "",
    "## Identity",
    `- Name: ${name}`,
  ];

  const add = (label: string, value: string | null | undefined) => {
    const v = value?.trim();
    if (v) lines.push(`- ${label}: ${v}`);
  };

  add("Headline", profile?.headline);
  add("Pronouns", profile?.pronouns);
  add("Bio", profile?.bio);
  add("Location", profile?.location);
  add("Timezone", profile?.timezone);
  add("Company", profile?.company);
  add("Job title", profile?.job_title);
  add("Values", profile?.values);
  add("Goals", profile?.goals);
  add("Decision style", profile?.decision_style);
  add("Risk tolerance", profile?.risk_tolerance);
  add("Personality notes", profile?.personality_notes);
  add("Interests", profile?.interests);
  add("Languages", profile?.languages);

  if (profile?.website) lines.push(`- Website: ${profile.website}`);
  if (profile?.twitter) lines.push(`- Twitter: ${profile.twitter}`);
  if (profile?.github) lines.push(`- GitHub: ${profile.github}`);
  if (profile?.linkedin) lines.push(`- LinkedIn: ${profile.linkedin}`);

  if (memories.length > 0) {
    lines.push("", "## Personal context (from reflections)");
    for (const m of memories.slice(0, 24)) {
      lines.push(`- ${m.text.trim()}`);
    }
  }

  lines.push(
    "",
    "## Behavior",
    "- Mirror how this person would think through trade-offs and priorities.",
    "- Be direct and practical; avoid generic assistant filler.",
    "- You are chatting as the user with their AI platform — help them reason, plan, and decide as themselves."
  );

  return lines.join("\n");
}

export function userAgentIdForUserId(userId: string): string {
  return `user-${userId}`;
}

export function isUserAgentId(agentId: string): boolean {
  return agentId.startsWith("user-");
}
