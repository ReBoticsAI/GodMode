import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";

vi.mock("../../config.js", () => ({
  config: {
    isSaas: true,
    dataDir: "/tmp/gm-746",
    saasAllowLocalPlugins: false,
  },
}));

const loadedPlugins = [
  {
    manifest: {
      id: "recipe-box",
      version: "0.0.1",
      departments: ["dept-recipe"],
    },
    pluginRoot: "/tmp/plugins/recipe-box",
  },
];

vi.mock("../../plugins/runtime.js", () => ({
  pluginRuntime: {
    get loaded() {
      return loadedPlugins;
    },
    getPlugin: (id: string) => ({
      manifest: { id, departments: [id] },
      pluginRoot: `/tmp/plugins/${id}`,
    }),
    hasPlugin: () => false,
    uninstallPluginForTenant: vi.fn(async () => undefined),
    allTools: () => [],
    unregister: vi.fn(),
  },
}));

vi.mock("../../tenant-registry.js", () => ({
  getTenantDb: () => new Database(":memory:"),
}));

vi.mock("../knowledge-store.js", () => ({
  importPluginKnowledgeFromRoot: () => undefined,
  refreshIntelligenceToolsAfterPluginInstall: () => undefined,
  removePluginKnowledge: () => undefined,
  stripIntelligenceToolsAfterPluginUninstall: () => undefined,
}));

vi.mock("../../kernel/plugin-object-types.js", () => ({
  applyPluginObjectTypeSeeds: () => undefined,
  registerPluginObjectTypes: () => undefined,
}));

vi.mock("../../kernel/registry.js", () => ({
  unregisterObjectTypesByPlugin: () => undefined,
}));

vi.mock("../../kernel/adapter-registry.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../kernel/adapter-registry.js")
  >();
  return {
    ...actual,
    emitKernelStructureChanged: () => undefined,
  };
});

vi.mock("../plugin-sqlite.js", () => ({
  closePluginSqlite: () => undefined,
}));

vi.mock("../../plugins/plugin-child-registry.js", () => ({
  getPluginChild: () => undefined,
}));

vi.mock("../capability-index.js", () => ({
  scheduleCapabilityRebuild: () => undefined,
}));

vi.mock("../plugin-capabilities.js", () => ({
  revokeCapabilityGrants: () => undefined,
}));

function ensureCoreTables(core: InstanceType<typeof Database>): void {
  core.exec(`
    CREATE TABLE IF NOT EXISTS platform_meta (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT
    );
  `);
  core.exec(`
    CREATE TABLE IF NOT EXISTS tenant_plugins (
      tenant_id TEXT NOT NULL,
      plugin_id TEXT NOT NULL,
      version TEXT NOT NULL,
      installed_at TEXT NOT NULL DEFAULT (datetime('now')),
      plugin_root TEXT,
      state TEXT NOT NULL DEFAULT 'active',
      desired_state TEXT NOT NULL DEFAULT 'active',
      last_error TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (tenant_id, plugin_id)
    );
  `);
}

import { config } from "../../config.js";
import {
  pruneSaasOperatorTenantPluginResidueOnce,
  reconcilePluginLifecycle,
  shouldAutoInstallLoadedPluginsOntoOperator,
} from "../plugin-lifecycle.js";

describe("operator plugin reconcile (#746)", () => {
  afterEach(() => {
    (config as { isSaas: boolean }).isSaas = true;
  });

  it("disables operator auto-install of host-wide plugins on SaaS", () => {
    (config as { isSaas: boolean }).isSaas = true;
    expect(shouldAutoInstallLoadedPluginsOntoOperator()).toBe(false);
  });

  it("keeps operator auto-install on non-SaaS (local/self-host)", () => {
    (config as { isSaas: boolean }).isSaas = false;
    expect(shouldAutoInstallLoadedPluginsOntoOperator()).toBe(true);
  });

  it("does not create operator tenant_plugins rows from host-loaded plugins on SaaS", async () => {
    (config as { isSaas: boolean }).isSaas = true;
    const core = new Database(":memory:");
    ensureCoreTables(core);
    const operatorDb = new Database(":memory:");
    operatorDb.exec(`CREATE TABLE structure_nodes (id TEXT PRIMARY KEY);`);

    await reconcilePluginLifecycle(core, "operator-tenant", operatorDb as never);

    const rows = core
      .prepare(
        `SELECT plugin_id FROM tenant_plugins WHERE tenant_id=? ORDER BY plugin_id`
      )
      .all("operator-tenant") as Array<{ plugin_id: string }>;
    expect(rows).toEqual([]);
  });

  it("one-time prunes leaked operator tenant_plugins on SaaS", async () => {
    (config as { isSaas: boolean }).isSaas = true;
    const core = new Database(":memory:");
    ensureCoreTables(core);
    const operatorDb = new Database(":memory:");
    operatorDb.exec(`
      CREATE TABLE structure_nodes (
        id TEXT PRIMARY KEY,
        built_in INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO structure_nodes (id, built_in) VALUES ('recipe-box', 0);
      INSERT INTO structure_nodes (id, built_in) VALUES ('tips', 0);
    `);

    core
      .prepare(
        `INSERT INTO tenant_plugins
         (tenant_id, plugin_id, version, plugin_root, state, desired_state)
         VALUES (?, ?, '0.0.1', ?, 'active', 'active')`
      )
      .run("operator-tenant", "recipe-box", "/tmp/plugins/recipe-box");
    core
      .prepare(
        `INSERT INTO tenant_plugins
         (tenant_id, plugin_id, version, plugin_root, state, desired_state)
         VALUES (?, ?, '0.0.1', ?, 'active', 'active')`
      )
      .run("operator-tenant", "tips", "/tmp/plugins/tips");

    const first = await pruneSaasOperatorTenantPluginResidueOnce(
      core,
      "operator-tenant"
    );
    expect(first.pruned.sort()).toEqual(["recipe-box", "tips"]);
    expect(
      core
        .prepare(`SELECT plugin_id FROM tenant_plugins WHERE tenant_id=?`)
        .all("operator-tenant")
    ).toEqual([]);
    expect(
      core
        .prepare(`SELECT value FROM platform_meta WHERE key=?`)
        .get("repair_saas_operator_tenant_plugins_v1") as { value: string }
    ).toEqual({ value: "done" });

    const second = await pruneSaasOperatorTenantPluginResidueOnce(
      core,
      "operator-tenant"
    );
    expect(second.pruned).toEqual([]);
  });
});
