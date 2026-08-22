import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateTenantDb } from "../../db.js";

describe("workflow seeds (#635)", () => {
  it("seeds Scaffold domain plugin with domain template and use_skill", () => {
    const db = new Database(":memory:");
    migrateTenantDb(db);

    const row = db
      .prepare(
        `SELECT id, name, enabled, config_json FROM ai_workflows WHERE id = 'scaffold-domain-plugin'`
      )
      .get() as
      | { id: string; name: string; enabled: number; config_json: string }
      | undefined;

    expect(row).toBeTruthy();
    expect(row!.name).toBe("Scaffold domain plugin");
    expect(row!.enabled).toBe(1);

    const graph = JSON.parse(row!.config_json) as {
      nodes: Array<{
        type: string;
        config?: { tool?: string; args?: Record<string, unknown> };
      }>;
    };
    expect(
      graph.nodes.some((n) => n.type === "tool" && n.config?.tool === "use_skill")
    ).toBe(true);
    expect(
      graph.nodes.some(
        (n) =>
          n.type === "tool" &&
          n.config?.tool === "scaffold_plugin" &&
          n.config?.args?.template === "domain"
      )
    ).toBe(true);
    expect(
      graph.nodes.some((n) => n.type === "tool" && n.config?.tool === "build_plugin")
    ).toBe(true);
    expect(
      graph.nodes.some(
        (n) => n.type === "tool" && n.config?.tool === "install_plugin"
      )
    ).toBe(true);

    migrateTenantDb(db);
    expect(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM ai_workflows WHERE id = 'scaffold-domain-plugin'`
          )
          .get() as { c: number }
      ).c
    ).toBe(1);

    db.close();
  });
});
