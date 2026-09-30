import { describe, expect, it } from "vitest";
import {
  GUIDE_CHOICE_PROFILES,
  GUIDE_NEXT_OPTIONS,
  guideChoiceProfilesForOptions,
} from "../guide-next-choice";

describe("guide choice cards", () => {
  it("compares every signup path on the same rows", () => {
    const labels = GUIDE_CHOICE_PROFILES[0].rows.map((row) => row.label);
    expect(GUIDE_CHOICE_PROFILES.map((profile) => profile.optionId).sort()).toEqual(
      GUIDE_NEXT_OPTIONS.map((option) => option.id).sort()
    );
    for (const profile of GUIDE_CHOICE_PROFILES) {
      expect(profile.rows.map((row) => row.label)).toEqual(labels);
      expect(profile.sell.trim().endsWith(".")).toBe(true);
    }
  });

  it("uses the option label the visitor will see", () => {
    const cards = guideChoiceProfilesForOptions([
      { id: "download", label: "Download for Windows" },
      { id: "cloud", label: "GodMode Cloud" },
    ]);
    expect(cards.map((card) => card.title)).toEqual([
      "GodMode Local",
      "GodMode Cloud",
    ]);
    expect(cards.map((card) => card.label)).toEqual([
      "Download for Windows",
      "GodMode Cloud",
    ]);
  });
});
