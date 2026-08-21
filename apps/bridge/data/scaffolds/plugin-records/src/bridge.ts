import type { GodModePluginRegister } from "@godmode/plugin-api";

/**
 * Records template: workspace ObjectTypes for true Core personal-OS entities.
 * Do not use this path for plugin business data (prefer template "domain").
 */
export const register: GodModePluginRegister = (api) => {
  const deptId = "__DEPT_ID__";
  const deptLabel = "__PLUGIN_NAME__";

  api.hooks.on("tenant:install", async ({ tenantId, host }) => {
    const db = host.getTenantDb(tenantId);
    db.prepare(
      `INSERT OR IGNORE INTO structure_nodes
         (id, parent_id, label, icon, segment, kind, right_sidebar, agent_id, built_in, sort_order, tabs_json)
       VALUES (?, NULL, ?, 'folder', ?, 'placeholder', NULL, NULL, 0, 99, NULL)`
    ).run(deptId, deptLabel, deptId);
    db.prepare(
      `INSERT OR IGNORE INTO structure_nodes
         (id, parent_id, label, icon, segment, kind, right_sidebar, agent_id, built_in, sort_order, tabs_json)
       VALUES (?, ?, ?, 'list', ?, 'record-list', NULL, NULL, 0, 0, NULL)`
    ).run(
      `${deptId}-items`,
      deptId,
      "Items",
      `${deptId}-items`
    );
  });

  api.tools.register([
    {
      name: "__PLUGIN_ID___hello",
      description: "Example tool from __PLUGIN_NAME__",
      handler: async () => ({ ok: true, plugin: "__PLUGIN_ID__", template: "records" }),
    },
  ]);
};
