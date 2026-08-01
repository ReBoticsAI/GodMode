import { describe, expect, it } from "vitest";
import {
  isDueDateFieldName,
  isEstimateFieldName,
  isIterationFieldName,
  isStartDateFieldName,
  isTextNoteFieldName,
} from "../github-projects-fields.js";

describe("github-projects-fields", () => {
  it("keeps start date out of due/target matching", () => {
    expect(isDueDateFieldName("Target Date")).toBe(true);
    expect(isDueDateFieldName("Due date")).toBe(true);
    expect(isDueDateFieldName("Start Date")).toBe(false);
    expect(isStartDateFieldName("Start Date")).toBe(true);
    expect(isStartDateFieldName("Due Date")).toBe(false);
  });

  it("matches estimate and text/note conventions", () => {
    expect(isEstimateFieldName("Estimate")).toBe(true);
    expect(isEstimateFieldName("Story Points")).toBe(true);
    expect(isTextNoteFieldName("Notes")).toBe(true);
    expect(isTextNoteFieldName("Priority")).toBe(false);
  });

  it("matches iteration / sprint names", () => {
    expect(isIterationFieldName("Iteration")).toBe(true);
    expect(isIterationFieldName("Sprint")).toBe(true);
    expect(isIterationFieldName("Status")).toBe(false);
  });
});
