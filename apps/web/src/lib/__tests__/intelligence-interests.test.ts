import { describe, expect, it } from "vitest";
import {
  INTELLIGENCE_ENTRY_ACTIONS,
  INTELLIGENCE_ENTRY_QUESTION,
  INTELLIGENCE_EXPLORE_MESSAGE,
  INTELLIGENCE_GRAPH_ORIENTATION,
  INTELLIGENCE_GREETING_HELLO,
  INTELLIGENCE_GREETING_QUESTION,
  INTELLIGENCE_INTERESTS,
  INTELLIGENCE_TOUR_FOCUS_QUESTION,
  INTELLIGENCE_TOUR_INTRO_MESSAGE,
  INTELLIGENCE_VISITOR_SIGNUP_MESSAGE,
  interestStartMessage,
} from "../intelligence-interests";

describe("intelligence interests", () => {
  it("opens with the entry greeting and three start actions", () => {
    expect(INTELLIGENCE_GREETING_HELLO).toBe("Hello,");
    expect(INTELLIGENCE_ENTRY_QUESTION).toBe("How would you like to get started?");
    expect(INTELLIGENCE_GREETING_QUESTION).toBe(INTELLIGENCE_ENTRY_QUESTION);
    expect(INTELLIGENCE_ENTRY_ACTIONS.map((item) => item.label)).toEqual([
      "Login",
      "Guided Tour",
      "Explore",
    ]);
    expect(INTELLIGENCE_ENTRY_ACTIONS.map((item) => item.id)).toEqual([
      "login",
      "guided-tour",
      "explore",
    ]);
  });

  it("moves Guided Tour to a focus question and keeps eight interest choices", () => {
    expect(INTELLIGENCE_TOUR_FOCUS_QUESTION).toBe("What should the tour focus on?");
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

  it("explains temporary explore mode and Graph orientation without em-dashes", () => {
    expect(INTELLIGENCE_GRAPH_ORIENTATION).toContain("GodMode Instance");
    expect(INTELLIGENCE_GRAPH_ORIENTATION).toContain("Structure in Space");
    expect(INTELLIGENCE_GRAPH_ORIENTATION).toContain("Graph search");
    expect(INTELLIGENCE_TOUR_INTRO_MESSAGE).toContain(INTELLIGENCE_GRAPH_ORIENTATION);
    expect(INTELLIGENCE_EXPLORE_MESSAGE).toContain(INTELLIGENCE_GRAPH_ORIENTATION);
    expect(INTELLIGENCE_EXPLORE_MESSAGE).toContain("I am Intelligence");
    expect(INTELLIGENCE_EXPLORE_MESSAGE).toContain("temporary visitor account");
    expect(INTELLIGENCE_EXPLORE_MESSAGE).toContain("will not be saved");
    expect(INTELLIGENCE_EXPLORE_MESSAGE).toContain("chat budget is limited");
    expect(INTELLIGENCE_EXPLORE_MESSAGE).toContain("Below you can pick GodMode Cloud");
    expect(INTELLIGENCE_EXPLORE_MESSAGE).not.toContain("\u2014");
    expect(INTELLIGENCE_EXPLORE_MESSAGE).not.toContain(" -- ");
    expect(INTELLIGENCE_TOUR_INTRO_MESSAGE).not.toContain("\u2014");
    expect(INTELLIGENCE_VISITOR_SIGNUP_MESSAGE).toContain("picking a path below");
    expect(INTELLIGENCE_VISITOR_SIGNUP_MESSAGE).toContain("GodMode Cloud");
    expect(INTELLIGENCE_VISITOR_SIGNUP_MESSAGE).not.toContain("\u2014");
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
