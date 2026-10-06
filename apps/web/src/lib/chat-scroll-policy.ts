/**
 * Social / Intelligence chat scroll policy.
 *
 * - Group channels: always follow the latest message (bottom).
 * - User sends: force scroll to bottom so their bubble is in view.
 * - Intelligence / assistant replies: once content exists, pin the viewport
 *   to the top of that reply so the user can read downward.
 * - Waiting stub (streaming assistant with no content yet): stay at bottom
 *   under the user bubble.
 */

export type ChatScrollMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  streaming?: boolean;
  text?: string;
  hasParts?: boolean;
};

export type ChatScrollAction =
  | { type: "none" }
  | { type: "bottom" }
  | { type: "message-start"; messageId: string };

function assistantHasContent(message: ChatScrollMessage): boolean {
  if (message.hasParts) return true;
  return Boolean(message.text?.trim());
}

export function chatScrollAction(opts: {
  conversationKind?: string | null;
  messages?: ChatScrollMessage[];
}): ChatScrollAction {
  if (opts.conversationKind === "group") return { type: "bottom" };
  const messages = opts.messages ?? [];
  if (messages.length === 0) return { type: "none" };

  const last = messages[messages.length - 1];
  if (last.role === "user") return { type: "bottom" };

  if (last.role === "assistant") {
    if (!assistantHasContent(last)) {
      // Empty stub / "Starting model…" under the user bubble: keep bottom.
      const prev = messages[messages.length - 2];
      if (last.streaming || prev?.role === "user") return { type: "bottom" };
      return { type: "none" };
    }
    return { type: "message-start", messageId: last.id };
  }

  return { type: "none" };
}

/** @deprecated Prefer chatScrollAction. Kept for narrow call sites/tests. */
export function shouldStickChatToBottom(opts: {
  conversationKind?: string | null;
  messages?: ChatScrollMessage[];
}): boolean {
  return chatScrollAction(opts).type === "bottom";
}
