import { describe, expect, it } from "vitest";
import {
  INTELLIGENCE_GREETING_HELLO,
  INTELLIGENCE_GREETING_QUESTION,
  INTELLIGENCE_INTERESTS,
  interestStartMessage,
} from "../intelligence-interests";

describe("intelligence interests", () => {
  it("opens with the hardcoded greeting and eight choices", () => {
    expect(INTELLIGENCE_GREETING_HELLO).toBe("Hello,");
    expect(INTELLIGENCE_GREETING_QUESTION).toBe("What are you interested in doing?");
    expect(INTELLIGENCE_INTERESTS.map((item) => item.label)).toEqual([
      "Create",
      "Earn",
      "Organize",
      "Automate",
      "Explore",
      "Battle",
      "Social",
      "Learn",
    ]);
  });

  it("stores the choice as the label and keeps the meanings for the model brief", () => {
    expect(interestStartMessage("create")).toBe("Create");
    expect(interestStartMessage("battle")).toBe("Battle");
    expect(INTELLIGENCE_INTERESTS.find((item) => item.id === "create")?.meaning).toContain(
      "examples"
    );
    expect(interestStartMessage("missing")).toBeNull();
  });
});
