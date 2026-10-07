import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { ensureSupportReportHooks } from "../support-report-hooks-seed.js";
import type { CoreDatabase } from "../../core-db.js";

describe("ensureSupportReportHooks", () => {
  it("seeds event notify hooks idempotently", () => {
    const db = new Database(":memory:") as unknown as CoreDatabase;
    const first = ensureSupportReportHooks(db, {
      ownerKind: "agent",
      ownerId: "intelligence",
      ownerTenantId: "tenant-1",
    });
    expect(first.created).toHaveLength(4);
    const second = ensureSupportReportHooks(db, {
      ownerKind: "agent",
      ownerId: "intelligence",
      ownerTenantId: "tenant-1",
    });
    expect(second.created).toHaveLength(0);
    const rows = (
      db.prepare(`SELECT name, event_type, action_kind FROM hooks ORDER BY name`).all() as Array<{
        name: string;
        event_type: string;
        action_kind: string;
      }>
    );
    expect(rows.map((r) => r.event_type).sort()).toEqual([
      "ops.report.created",
      "support.platform_issue.reported",
      "support.platform_pr.updated",
      "support.resource_issue.reported",
    ]);
    expect(rows.every((r) => r.action_kind === "notify")).toBe(true);
    expect(rows.map((r) => r.name)).toContain("support-platform-pr-notify");
  });
});
