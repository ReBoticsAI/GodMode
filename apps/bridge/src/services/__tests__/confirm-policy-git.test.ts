import { describe, expect, it } from "vitest";
import { shouldAutoApproveTool } from "../confirm-policy.js";
import type { AiAgent } from "../agents/types.js";

function agent(partial?: Partial<AiAgent>): AiAgent {
  return {
    id: "intelligence",
    name: "Intelligence",
    role: "platform",
    department: null,
    status: "idle",
    config: { codeAccess: true, codeAutonomy: "full" },
    autoApprove: [],
    ...partial,
  } as AiAgent;
}

describe("confirm-policy git_push", () => {
  it("does not auto-approve git_push under full autonomy", async () => {
    const ok = await shouldAutoApproveTool(
      agent(),
      "git_push",
      async () => false,
      { toolCallId: "t1", name: "git_push", args: {} },
      "full"
    );
    expect(ok).toBe(false);
  });

  it("does not auto-approve git_push via autoApprove star", async () => {
    const ok = await shouldAutoApproveTool(
      agent({ autoApprove: ["*"] }),
      "git_push",
      async () => false,
      { toolCallId: "t1", name: "git_push", args: {} },
      "writes"
    );
    expect(ok).toBe(false);
  });

  it("approves git_push only when the confirm callback returns true", async () => {
    const ok = await shouldAutoApproveTool(
      agent(),
      "git_push",
      async () => true,
      { toolCallId: "t1", name: "git_push", args: {} },
      "full"
    );
    expect(ok).toBe(true);
  });
});
