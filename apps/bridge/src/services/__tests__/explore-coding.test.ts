import { describe, expect, it } from "vitest";
import {
  exploreToolBlocked,
  parseExploreHandoff,
} from "../coding/explore-coding.js";

describe("explore-coding (#450)", () => {
  it("blocks mutating coding tools in explore mode", () => {
    expect(exploreToolBlocked("edit_file")).toBe(true);
    expect(exploreToolBlocked("git_commit")).toBe(true);
    expect(exploreToolBlocked("run_terminal")).toBe(true);
    expect(exploreToolBlocked("read_file")).toBe(false);
    expect(exploreToolBlocked("git_status")).toBe(false);
    expect(exploreToolBlocked("grep")).toBe(false);
  });

  it("parses JSON handoff objects from explorer answers", () => {
    const handoff = parseExploreHandoff(
      'Notes.\n{"paths":["apps/web/src/a.ts"],"findings":["handler lives here"],"openQuestions":["who calls it?"]}'
    );
    expect(handoff.paths).toEqual(["apps/web/src/a.ts"]);
    expect(handoff.findings[0]).toMatch(/handler/);
    expect(handoff.openQuestions).toHaveLength(1);
  });

  it("wraps plain text as a single finding", () => {
    const handoff = parseExploreHandoff("look in fs-tools.ts");
    expect(handoff.findings).toEqual(["look in fs-tools.ts"]);
    expect(handoff.paths).toEqual([]);
  });
});
