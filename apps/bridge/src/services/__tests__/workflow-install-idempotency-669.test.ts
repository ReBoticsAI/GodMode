/**
 * #669: scaffold workflow install must carry Idempotency-Key + trusted confirm.
 */
import { describe, expect, it } from "vitest";
import {
  WORKFLOW_TRUSTED_CONFIRM_TOOLS,
  withWorkflowToolTrust,
  workflowToolCallId,
} from "../ai-workflows.js";
import type { ToolExecContext } from "../ai-tool-executor.js";

describe("workflow install idempotency (#669)", () => {
  const base = { db: {} } as ToolExecContext;

  it("builds a unique tool call id per run/node/visit", () => {
    expect(workflowToolCallId("run-1", "install", 1)).toBe("wf:run-1:install:1");
    expect(workflowToolCallId("run-1", "install", 2)).toBe("wf:run-1:install:2");
  });

  it("sets activeToolCallId for every workflow tool node", () => {
    const ctx = withWorkflowToolTrust(base, {
      runId: "r1",
      nodeId: "n-install",
      visit: 1,
      toolName: "list_plugins",
    });
    expect(ctx.activeToolCallId).toBe("wf:r1:n-install:1");
    expect(ctx.confirmationApproved).toBeUndefined();
  });

  it("marks install_plugin and build_plugin as trusted confirm", () => {
    expect(WORKFLOW_TRUSTED_CONFIRM_TOOLS.has("install_plugin")).toBe(true);
    expect(WORKFLOW_TRUSTED_CONFIRM_TOOLS.has("build_plugin")).toBe(true);

    const install = withWorkflowToolTrust(base, {
      runId: "r2",
      nodeId: "install",
      visit: 1,
      toolName: "install_plugin",
    });
    expect(install.activeToolCallId).toBe("wf:r2:install:1");
    expect(install.confirmationApproved).toBe(true);

    const build = withWorkflowToolTrust(base, {
      runId: "r2",
      nodeId: "build",
      visit: 1,
      toolName: "build_plugin",
    });
    expect(build.confirmationApproved).toBe(true);
  });

  it("maps activeToolCallId onto kernel idempotency (no bare required key)", () => {
    const install = withWorkflowToolTrust(base, {
      runId: "r3",
      nodeId: "install",
      visit: 3,
      toolName: "install_plugin",
    });
    // Same mapping used by kernelOperationContext in ai-tool-executor.
    const idempotencyKey = install.activeToolCallId;
    expect(idempotencyKey).toBeTruthy();
    expect(String(idempotencyKey)).not.toMatch(/KERNEL_IDEMPOTENCY_REQUIRED/i);
    expect(install.confirmationApproved).toBe(true);
  });
});
