/** First Intelligence landing. Instant and hardcoded. No model call. */
export const INTELLIGENCE_GREETING_HELLO = "Hello,";
export const INTELLIGENCE_GREETING_QUESTION = "What are you interested in doing?";

export const INTELLIGENCE_INTERESTS = [
  {
    id: "create",
    label: "Create",
    meaning:
      "making things in GodMode. Content, plugins, and workflows are examples, along with pages, agents, structure, knowledge, and other Graph nodes",
  },
  {
    id: "earn",
    label: "Earn",
    meaning:
      "selling what you make. A local instance can stay local with a GodMode Seller account",
  },
  {
    id: "organize",
    label: "Organize",
    meaning: "managing what you make",
  },
  {
    id: "automate",
    label: "Automate",
    meaning: "automating what you make",
  },
  {
    id: "explore",
    label: "Explore",
    meaning: "maneuvering your structure in space",
  },
  {
    id: "battle",
    label: "Battle",
    meaning: "encountering a hostile in space",
  },
  {
    id: "social",
    label: "Social",
    meaning: "encountering a friendly in space",
  },
  {
    id: "learn",
    label: "Learn",
    meaning: "gaining access to new knowledge by connecting to others in space",
  },
] as const;

export type IntelligenceInterestId = (typeof INTELLIGENCE_INTERESTS)[number]["id"];

/** Short label stored in the thread. The model brief is added server-side. */
export function interestStartMessage(id: string): string | null {
  const item = INTELLIGENCE_INTERESTS.find((row) => row.id === id);
  return item ? item.label : null;
}
