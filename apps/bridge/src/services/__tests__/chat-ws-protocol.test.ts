/**
 * Protocol exceptions for Intelligence Chat WebSocket streaming (#442).
 */
import { describe, expect, it } from "vitest";
import { PROTOCOL_EXCEPTIONS } from "../../kernel/protocol-exceptions.js";

describe("chat websocket protocol exception", () => {
  it("registers GET /ws/chat", () => {
    const hit = PROTOCOL_EXCEPTIONS.find((e) => e.id === "websocket-chat");
    expect(hit).toBeTruthy();
    expect(hit?.methods).toContain("GET");
    expect(hit?.pathPattern).toBe("/ws/chat");
  });

  it("registers POST /api/ai/chat SSE adapter exception", () => {
    const hit = PROTOCOL_EXCEPTIONS.find((e) => e.id === "ai-chat-sse");
    expect(hit).toBeTruthy();
    expect(hit?.methods).toContain("POST");
    expect(hit?.pathPattern).toBe("/api/ai/chat");
  });
});
