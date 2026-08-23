import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateTenantDb } from "../../db.js";

describe("workflow seeds (#635)", () => {
  it("seeds Scaffold domain plugin via boot migration v26", () => {
    const db = new Database(":memory:");
    migrateTenantDb(db);

    const row = db
      .prepare(
        `SELECT id, name, enabled, agent_id, config_json FROM ai_workflows WHERE id = 'scaffold-domain-plugin'`
      )
      .get() as
      | {
          id: string;
          name: string;
          enabled: number;
          agent_id: string | null;
          config_json: string;
        }
      | undefined;

    expect(row).toBeTruthy();
    expect(row!.name).toBe("Scaffold domain plugin");
    expect(row!.enabled).toBe(1);
    expect(row!.agent_id).toBe("intelligence");
    expect(
      (
        db
          .prepare(`SELECT name FROM schema_version WHERE version = 26`)
          .get() as { name: string } | undefined
      )?.name
    ).toBe("scaffold_domain_plugin_workflow_v1");
    expect(
      (
        db
          .prepare(`SELECT name FROM schema_version WHERE version = 27`)
          .get() as { name: string } | undefined
      )?.name
    ).toBe("scaffold_domain_plugin_workflow_ot_v2");
    expect(
      (
        db
          .prepare(`SELECT name FROM schema_version WHERE version = 28`)
          .get() as { name: string } | undefined
      )?.name
    ).toBe("scaffold_domain_plugin_workflow_dogfood_v3");

    const graph = JSON.parse(row!.config_json) as {
      nodes: Array<{
        type: string;
        config?: {
          tool?: string;
          args?: Record<string, unknown>;
          system?: string;
          maxIterations?: number;
          timeoutMs?: number;
        };
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
    const prove = graph.nodes.find((n) => n.config?.system?.includes("ObjectType"));
    expect(prove?.config?.system).toMatch(/create_|list_records|objectType/i);
    const implement = graph.nodes.find((n) =>
      n.config?.system?.includes("RecordAdapter")
    );
    expect(implement?.config?.system).toMatch(/ObjectType|openPluginDb/);
    expect(implement?.config?.system).toMatch(/blocked|Finish|stop/i);
    expect(implement?.config?.maxIterations).toBe(12);
    expect(implement?.config?.timeoutMs).toBe(300_000);

    // Idempotent: remigrate does not duplicate (v26/v27/v28 already applied).
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

  it("applies v26 on tenants that already stopped before scaffold seed", () => {
    const db = new Database(":memory:");
    migrateTenantDb(db);
    db.prepare(`DELETE FROM ai_workflows WHERE id = 'scaffold-domain-plugin'`).run();
    db.prepare(`DELETE FROM schema_version WHERE version = 26`).run();

    migrateTenantDb(db);

    const row = db
      .prepare(
        `SELECT id, agent_id FROM ai_workflows WHERE id = 'scaffold-domain-plugin'`
      )
      .get() as { id: string; agent_id: string | null } | undefined;
    expect(row?.id).toBe("scaffold-domain-plugin");
    expect(row?.agent_id).toBe("intelligence");

    db.close();
  });
});
