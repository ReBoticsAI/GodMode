import { describe, expect, it } from "vitest";
import {
  sharesUserTooling,
  USER_KNOWLEDGE_AGENT_ID,
} from "@/lib/focus-chrome";

describe("sharesUserTooling", () => {
  it("shares You's tools for Digital You and per-user personas", () => {
    expect(sharesUserTooling("digital-you")).toBe(true);
    expect(sharesUserTooling("user-abc")).toBe(true);
    expect(USER_KNOWLEDGE_AGENT_ID).toBe("digital-you");
  });

  it("keeps other agents on their own tools", () => {
    expect(sharesUserTooling("intelligence")).toBe(false);
    expect(sharesUserTooling("research")).toBe(false);
    expect(sharesUserTooling("ops")).toBe(false);
    expect(sharesUserTooling("builder")).toBe(false);
    expect(sharesUserTooling(null)).toBe(false);
  });
});
