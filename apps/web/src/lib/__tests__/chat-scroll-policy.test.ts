import { describe, expect, it } from "vitest";
import { chatScrollAction, shouldStickChatToBottom } from "../chat-scroll-policy";

describe("chatScrollAction", () => {
  it("always sticks to bottom for group channels", () => {
    expect(
      chatScrollAction({
        conversationKind: "group",
        messages: [{ id: "a1", role: "assistant", text: "hi" }],
      })
    ).toEqual({ type: "bottom" });
  });

  it("scrolls to bottom for user sends", () => {
    expect(
      chatScrollAction({
        messages: [
          { id: "a1", role: "assistant", text: "Explore…" },
          { id: "u1", role: "user", text: "What can GodMode do?" },
        ],
      })
    ).toEqual({ type: "bottom" });
  });

  it("keeps bottom while waiting on an empty assistant stub under a user turn", () => {
    expect(
      chatScrollAction({
        messages: [
          { id: "u1", role: "user", text: "Hi" },
          { id: "a2", role: "assistant", streaming: true, text: "" },
        ],
      })
    ).toEqual({ type: "bottom" });
    expect(
      chatScrollAction({
        messages: [
          { id: "u1", role: "user", text: "Hi" },
          { id: "a2", role: "assistant", streaming: false, text: "" },
        ],
      })
    ).toEqual({ type: "bottom" });
  });

  it("pins to the top of an Intelligence reply once it has content", () => {
    expect(
      chatScrollAction({
        messages: [
          { id: "a1", role: "assistant", text: "Explore…" },
          { id: "u1", role: "user", text: "What can GodMode do?" },
          {
            id: "a2",
            role: "assistant",
            streaming: true,
            text: "You are the center…",
          },
        ],
      })
    ).toEqual({ type: "message-start", messageId: "a2" });

    expect(
      chatScrollAction({
        messages: [{ id: "a1", role: "assistant", text: "Explore intro" }],
      })
    ).toEqual({ type: "message-start", messageId: "a1" });
  });
});

describe("shouldStickChatToBottom", () => {
  it("is true only for bottom actions", () => {
    expect(
      shouldStickChatToBottom({
        messages: [{ id: "u1", role: "user", text: "hi" }],
      })
    ).toBe(true);
    expect(
      shouldStickChatToBottom({
        messages: [{ id: "a1", role: "assistant", text: "hi" }],
      })
    ).toBe(false);
  });
});
