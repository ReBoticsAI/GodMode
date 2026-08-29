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
    getPlugin: () => undefined,
    hasPlugin: () => false,
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

import { config } from "../../config.js";
import {
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
});
