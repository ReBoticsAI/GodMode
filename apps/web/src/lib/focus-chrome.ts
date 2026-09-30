import {
  BellIcon,
  BookOpenIcon,
  BotIcon,
  CalendarIcon,
  CodeIcon,
  HashIcon,
  InboxIcon,
  InfoIcon,
  KeyRoundIcon,
  LandmarkIcon,
  LayersIcon,
  LifeBuoyIcon,
  MessageCircleIcon,
  PackageIcon,
  RocketIcon,
  SettingsIcon,
  Share2Icon,
  ShieldCheckIcon,
  ShieldIcon,
  StoreIcon,
  UsersIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react";
import type { LeftRailTab } from "@/lib/intelligence-context";
import type { OpenChatWindow } from "@/lib/chat-windows";
import { isUserAgentId } from "@/lib/structure-agents";

export type FocusChrome = {
  label: string;
  accent: string;
  Icon: LucideIcon;
};

/** Tabs whose content is scoped to the active agent. */
const AGENT_SCOPED_TABS = new Set<LeftRailTab>([
  "calendar",
  "projects",
  "bank",
  "vault",
]);

function possessiveLabel(owner: string, surface: string): string {
  const name = owner.trim();
  if (!name) return surface;
  const poss = /s$/i.test(name) ? `${name}'` : `${name}'s`;
  return `${poss} ${surface}`;
}

/** Icons for Information panel tabs (same mapping as the floating window title). */
export function focusChromeForLeftTab(
  tab: LeftRailTab,
  opts?: { infoNodeLabel?: string | null; scopeAgentLabel?: string | null }
): FocusChrome {
  const agent = opts?.scopeAgentLabel?.trim() || null;

  switch (tab) {
    case "calendar":
      return {
        label: agent ? possessiveLabel(agent, "Calendar") : "Calendar",
        accent: "#38bdf8",
        Icon: CalendarIcon,
      };
    case "projects":
      return {
        label: agent ? possessiveLabel(agent, "Automations") : "Automations",
        accent: "#a78bfa",
        Icon: WorkflowIcon,
      };
    case "knowledge":
      return { label: "Knowledge", accent: "#34d399", Icon: BookOpenIcon };
    case "bank":
      return {
        label: agent ? possessiveLabel(agent, "Bank") : "Bank",
        accent: "#fbbf24",
        Icon: LandmarkIcon,
      };
    case "vault":
      return {
        label: agent ? possessiveLabel(agent, "Vault") : "Agent Vault",
        accent: "#f87171",
        Icon: ShieldCheckIcon,
      };
    case "platform-vault":
      return { label: "Platform Vault", accent: "#fbbf24", Icon: KeyRoundIcon };
    case "personal-vault":
      return {
        label: "Personal Vault",
        accent: "#f87171",
        Icon: ShieldCheckIcon,
      };
    case "admin":
      return { label: "Admin", accent: "#a78bfa", Icon: ShieldIcon };
    case "wiki":
      return { label: "Wiki", accent: "#34d399", Icon: BookOpenIcon };
    case "support":
      return { label: "Support", accent: "#818cf8", Icon: LifeBuoyIcon };
    case "settings":
      return { label: "Settings", accent: "#94a3b8", Icon: SettingsIcon };
    case "shared":
      return { label: "Shared", accent: "#818cf8", Icon: Share2Icon };
    case "marketplace":
      return { label: "Marketplace", accent: "#fb923c", Icon: StoreIcon };
    case "structure":
      return { label: "Structure", accent: "#60a5fa", Icon: LayersIcon };
    case "coding":
      return { label: "Coding", accent: "#38bdf8", Icon: CodeIcon };
    case "releases":
      return { label: "Releases", accent: "#f472b6", Icon: RocketIcon };
    case "agents":
      return { label: "Agents", accent: "#a78bfa", Icon: WorkflowIcon };
    case "users":
      return { label: "Profile", accent: "#34d399", Icon: UsersIcon };
    case "tasks":
      return { label: "Tasks", accent: "#a78bfa", Icon: PackageIcon };
    case "notifications":
      return { label: "Notifications", accent: "#fb923c", Icon: BellIcon };
    case "contacts":
      return { label: "Contacts", accent: "#38bdf8", Icon: UsersIcon };
    case "dms":
      return {
        label: "Direct Messages",
        accent: "#38bdf8",
        Icon: MessageCircleIcon,
      };
    case "channels":
      return { label: "Channels", accent: "#38bdf8", Icon: HashIcon };
    case "info":
    default: {
      const nodeLabel = opts?.infoNodeLabel?.trim();
      return {
        label: nodeLabel || "Information",
        accent: "#38bdf8",
        Icon: InfoIcon,
      };
    }
  }
}

export function isAgentScopedLeftTab(tab: LeftRailTab): boolean {
  return AGENT_SCOPED_TABS.has(tab);
}

/** Best-effort display name for an agent id when the catalog is unavailable. */
export function fallbackAgentLabel(agentId: string): string {
  if (agentId === "intelligence") return "Intelligence";
  if (agentId === "digital-you") return "Digital You";
  return agentId
    .split(/[-_]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

/** Digital You and per-user persona agents. */
export function isPersonaAgent(agentId: string | null | undefined): boolean {
  return agentId === "digital-you" || (agentId != null && isUserAgentId(agentId));
}

/** Knowledge for You lives on Digital You. There is no separate user knowledge table. */
export const USER_KNOWLEDGE_AGENT_ID = "digital-you";

/** Digital You and per-user personas open You's calendar, tasks, bank, and vault. */
export function sharesUserTooling(agentId: string | null | undefined): boolean {
  return isPersonaAgent(agentId);
}

export function displayNameForAgent(
  agentId: string,
  name?: string | null
): string {
  if (agentId === "intelligence") return "Intelligence";
  const trimmed = name?.trim();
  if (trimmed && trimmed !== agentId) return trimmed;
  return fallbackAgentLabel(agentId);
}

export function focusChromeForChatWindow(win: OpenChatWindow): FocusChrome {
  if (win.kind === "agent") {
    return { label: win.title || "Agent chat", accent: "#a78bfa", Icon: BotIcon };
  }
  if (win.kind === "channel") {
    return {
      label: win.title ? `# ${win.title}` : "Channel",
      accent: "#38bdf8",
      Icon: HashIcon,
    };
  }
  return {
    label: win.title || "Direct message",
    accent: "#38bdf8",
    Icon: MessageCircleIcon,
  };
}

export function focusChromeForInbox(): FocusChrome {
  return { label: "Chat inbox", accent: "#38bdf8", Icon: InboxIcon };
}

export function resolveFocusChrome(input: {
  activeWindowId: string | null;
  informationPanelOpen: boolean;
  informationPanelMinimized: boolean;
  activeLeftTab: LeftRailTab;
  chatInboxOpen: boolean;
  openChatWindows: OpenChatWindow[];
  focusedChatWindowId: string | null;
  infoNodeLabel?: string | null;
  scopeAgentLabel?: string | null;
}): FocusChrome | null {
  const {
    activeWindowId,
    informationPanelOpen,
    informationPanelMinimized,
    activeLeftTab,
    chatInboxOpen,
    openChatWindows,
    focusedChatWindowId,
    infoNodeLabel,
    scopeAgentLabel,
  } = input;

  const tabChrome = () =>
    focusChromeForLeftTab(activeLeftTab, { infoNodeLabel, scopeAgentLabel });

  if (activeWindowId === "information") {
    if (informationPanelOpen && !informationPanelMinimized) {
      return tabChrome();
    }
  }

  if (activeWindowId === "chat-inbox" && chatInboxOpen) {
    return focusChromeForInbox();
  }

  if (activeWindowId) {
    const win = openChatWindows.find((w) => w.id === activeWindowId);
    if (win && !win.minimized) return focusChromeForChatWindow(win);
  }

  if (focusedChatWindowId) {
    const win = openChatWindows.find((w) => w.id === focusedChatWindowId);
    if (win && !win.minimized) return focusChromeForChatWindow(win);
  }

  if (informationPanelOpen && !informationPanelMinimized) {
    return tabChrome();
  }

  return null;
}
