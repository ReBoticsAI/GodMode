import { describe, expect, it } from "vitest";
import { summarizeRunCardTitle } from "../run-card-title.js";

describe("summarizeRunCardTitle", () => {
  it("prefers quoted error text over the full prompt", () => {
    const title = summarizeRunCardTitle(
      'Hey, when I ask Intelligence to watch PR checks it dies with "Unknown JSON field: conclusion" from the gh CLI. Can you dig in, fix it properly, add a regression if it makes sense, and open a PR? Don\'t merge.'
    );
    expect(title.length).toBeLessThanOrEqual(72);
    expect(title).toMatch(/Unknown JSON field: conclusion/i);
    expect(title).not.toMatch(/^Hey,/i);
    expect(title).not.toMatch(/Don'?t merge/i);
  });

  it("summarizes worktree read/list bugs without dumping the ask", () => {
    const title = summarizeRunCardTitle(
      "I've been hitting a bug where Intelligence can't read or list files once it's working inside a git worktree under .worktrees. Can you dig into that, fix it with a proper regression test, and open a PR? Don't merge it yet."
    );
    expect(title.length).toBeLessThanOrEqual(72);
    expect(title.toLowerCase()).toMatch(/read|list|worktree|\.worktrees/);
    expect(title).not.toMatch(/Can you dig/i);
    expect(title).not.toMatch(/Don't merge/i);
  });

  it("falls back cleanly for short asks", () => {
    expect(summarizeRunCardTitle("Rename the Vault tab label")).toBe(
      "Rename the Vault tab label"
    );
    expect(summarizeRunCardTitle("   ")).toBe("Run");
  });

  it("shortens Active work title complaints instead of pasting the message", () => {
    expect(
      summarizeRunCardTitle(
        "The Active work titles up top keep pasting my whole message instead of a short title. It's kind of messy. Can you fix that and open a PR?"
      )
    ).toBe("Shorten Active work titles");

    expect(
      summarizeRunCardTitle(
        "The Active work titles on the agent board are just dumping my whole chat prompt. Can you make those short summaries instead, add a regression test, and open a PR? Don't merge."
      )
    ).toBe("Shorten Active work titles");
  });

  it("does not use the full first sentence as the board title", () => {
    const title = summarizeRunCardTitle(
      "The sidebar labels wrap awkwardly on narrow widths and look messy. Can you fix that and open a PR?"
    );
    expect(title.length).toBeLessThanOrEqual(72);
    expect(title).not.toMatch(/look messy/i);
    expect(title.toLowerCase()).toMatch(/sidebar|label|fix/);
  });
});
