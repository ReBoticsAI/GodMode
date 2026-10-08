import { describe, expect, it } from "vitest";
import {
  SUPPORT_JOB1_OPTIONS,
  filterSchemasOutsideSignupGuide,
  isSupportBugIntakeMessage,
  resolveSupportIntakeGuide,
  shouldBypassSignupGuideForSupport,
  supportPathModelGuide,
} from "../support-intake.js";
import { resolveUserChoice } from "../guide-ui-tools.js";

describe("support-intake", () => {
  it("defaults ask_user_choice to Log vs Handoff", () => {
    const choice = resolveUserChoice({
      question: "How should we handle this bug?",
    });
    expect(choice.ok).toBe(true);
    if (!choice.ok || choice.uiAction.type !== "guide_choice") return;
    expect(choice.uiAction.options.map((o) => o.id)).toEqual(
      SUPPORT_JOB1_OPTIONS.map((o) => o.id)
    );
  });

  it("strips ask_guide_choice outside signup", () => {
    const schemas = [
      { function: { name: "ask_guide_choice" } },
      { function: { name: "ask_user_choice" } },
      { function: { name: "report_platform_issue" } },
    ];
    expect(
      filterSchemasOutsideSignupGuide(schemas).map((s) => s.function.name)
    ).toEqual(["ask_user_choice", "report_platform_issue"]);
  });

  it("detects Bug pill intake messages", () => {
    expect(
      isSupportBugIntakeMessage(
        "I tapped the Bug pill and attached a screenshot of the current page."
      )
    ).toBe(true);
    expect(isSupportBugIntakeMessage("hello")).toBe(false);
  });

  it("guides Log and Handoff path ids toward report_platform_issue", () => {
    const log = supportPathModelGuide("log_bug");
    expect(log).toContain("report_platform_issue");
    expect(log).toMatch(/Do not call ask_guide_choice/);
    const handoff = supportPathModelGuide("handoff_coding");
    expect(handoff).toContain("report_platform_issue");
    expect(handoff).toMatch(/Do not call ask_guide_choice/);
    expect(resolveSupportIntakeGuide({ pathId: "log_bug" })).toBe(log);
    expect(
      resolveSupportIntakeGuide({
        userMessage: "Use the Support skill (job 1): gather then choose",
      })
    ).toContain("report_platform_issue");
  });

  it("bypasses trial signup-guide RBAC for Bug pill and follow-ups", () => {
    expect(
      shouldBypassSignupGuideForSupport({
        userMessage:
          "I tapped the Bug pill and attached a screenshot of the current page.",
      })
    ).toBe(true);
    expect(
      shouldBypassSignupGuideForSupport({ pathId: "log_bug", userMessage: "Log" })
    ).toBe(true);
    expect(
      shouldBypassSignupGuideForSupport({
        userMessage: "Log",
        historyTexts: [
          "I tapped the Bug pill and attached a screenshot of the current page.",
        ],
      })
    ).toBe(true);
    expect(
      shouldBypassSignupGuideForSupport({ userMessage: "hello", historyTexts: [] })
    ).toBe(false);
  });
});
