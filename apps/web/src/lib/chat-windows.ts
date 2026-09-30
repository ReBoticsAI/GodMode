/**
 * Multi-window Graph chat: ids and open-window records.
 * Bottom composer drafts and focus live in intelligence-context.
 */

export type ChatWindowKind = "agent" | "dm" | "channel";

export type ChatEtherLine = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  at: number;
  streaming?: boolean;
};

export type OpenChatWindow = {
  id: string;
  kind: ChatWindowKind;
  title: string;
  conversationId?: string;
  agentId?: string;
  /** Persisted ai_chats id when known. */
  agentChatId?: string | null;
  /** Agent transcript (promoted ether or streamed into the window). */
  etherLines?: ChatEtherLine[];
  minimized?: boolean;
};

export type OpenChatWindowTarget =
  | {
      kind: "agent";
      agentId: string;
      title?: string;
      agentChatId?: string | null;
      etherLines?: ChatEtherLine[];
    }
  | {
      kind: "dm" | "channel";
      conversationId: string;
      title: string;
    };

export function chatWindowIdForAgent(agentId: string, agentChatId?: string | null): string {
  const session = agentChatId?.trim() || "session";
  return `chat:agent:${agentId}:${session}`;
}

export function chatWindowIdForConversation(conversationId: string): string {
  return `chat:conv:${conversationId}`;
}

export function parseChatWindowId(id: string): {
  kind: ChatWindowKind | null;
  agentId?: string;
  agentChatId?: string;
  conversationId?: string;
} {
  if (id.startsWith("chat:conv:")) {
    return { kind: "dm", conversationId: id.slice("chat:conv:".length) };
  }
  if (id.startsWith("chat:agent:")) {
    const rest = id.slice("chat:agent:".length);
    const i = rest.indexOf(":");
    if (i < 0) return { kind: "agent", agentId: rest, agentChatId: "session" };
    return {
      kind: "agent",
      agentId: rest.slice(0, i),
      agentChatId: rest.slice(i + 1),
    };
  }
  return { kind: null };
}

export function unreadCountsByKind(
  conversations: Array<{ kind: string; unreadCount: number }>
): { dms: number; channels: number; total: number } {
  let dms = 0;
  let channels = 0;
  for (const c of conversations) {
    const n = c.unreadCount || 0;
    if (c.kind === "group") channels += n;
    else dms += n;
  }
  return { dms, channels, total: dms + channels };
}
