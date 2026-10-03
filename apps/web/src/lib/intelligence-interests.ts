/** First Intelligence landing. Instant and hardcoded. No model call. */
export const INTELLIGENCE_GREETING_HELLO = "Hello,";

/** Entry step question (Login / Guided Tour / Explore). */
export const INTELLIGENCE_ENTRY_QUESTION = "How would you like to get started?";

/** Shown after Guided Tour is chosen. */
export const INTELLIGENCE_TOUR_FOCUS_QUESTION = "What should the tour focus on?";

/** @deprecated Prefer INTELLIGENCE_ENTRY_QUESTION / INTELLIGENCE_TOUR_FOCUS_QUESTION. */
export const INTELLIGENCE_GREETING_QUESTION = INTELLIGENCE_ENTRY_QUESTION;

export const INTELLIGENCE_ENTRY_ACTIONS = [
  { id: "login", label: "Login" },
  { id: "guided-tour", label: "Guided Tour" },
  { id: "explore", label: "Explore" },
] as const;

export type IntelligenceEntryActionId =
  (typeof INTELLIGENCE_ENTRY_ACTIONS)[number]["id"];

/**
 * Shared platform framing for Explore and Guided Tour intros.
 * The 3D Graph is Structure in Space: the zoomed-out view of a GodMode Instance.
 */
export const INTELLIGENCE_GRAPH_ORIENTATION =
  "The 3D Graph is a representation of your GodMode Instance. It is how you navigate around: Structure in Space. Nodes and edges make up that Structure. Workspaces connect into the Graph.\n\n" +
  "GodMode is the zoomed-out view of that Structure in Space. From here you Create, Edit, Organize, Connect, Monitor, Execute, Validate, and Govern yourself, your people, and your agents.\n\n" +
  "You can also navigate with Graph search at the bottom of the screen: ask Intelligence, find nodes, or run an action. As you build what you want the Graph to include, you can watch it grow and see how each new piece connects to everything else.";

/**
 * Assistant reply when the visitor picks Explore on the entry step.
 * Temporary accounts keep Graph open; progress is not durable without signup/signin.
 */
export const INTELLIGENCE_EXPLORE_MESSAGE =
  `${INTELLIGENCE_GRAPH_ORIENTATION}\n\n` +
  "I am Intelligence, GodMode's AI. You can talk to me and ask questions about anything here.\n\n" +
  "You are on a temporary visitor account. Feel free to explore GodMode. What you do will not be saved unless you sign up for a GodMode Cloud account or sign in to an existing one.\n\n" +
  "Your chat budget is limited on this trial. When it runs out, sign in or buy Inference through GodMode to keep chatting.\n\n" +
  "Below you can pick GodMode Cloud, Inference, Cloud with Inference, Seller, or download for this computer.";

/**
 * Assistant reply when a temporary visitor picks Sign up from the Login step
 * on a non-SaaS hub (plan cards follow in chat).
 */
export const INTELLIGENCE_VISITOR_SIGNUP_MESSAGE =
  "Create an account by picking a path below. GodMode Cloud hosts the workspace. Inference supplies the models. Seller is commerce for a local install. Or download GodMode for this computer.";

/** Shown above the interest grid on the Guided Tour step. */
export const INTELLIGENCE_TOUR_INTRO_MESSAGE =
  `${INTELLIGENCE_GRAPH_ORIENTATION}\n\n` +
  "Pick a focus and I will walk the Graph with you so you can see how those pieces connect.";

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
