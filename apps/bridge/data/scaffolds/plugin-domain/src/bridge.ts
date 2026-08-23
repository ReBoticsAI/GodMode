import type { GodModePluginRegister } from "@godmode/plugin-api";
import {
  ensureDomainItemsTable,
  registerDomainSqliteObjectType,
} from "./domain-sqlite-ot.js";

const PLUGIN_ID = "__PLUGIN_ID__";
const RECORD_TYPE = "__RECORD_TYPE__";

export const register: GodModePluginRegister = (api) => {
  const deptId = "__DEPT_ID__";
  const deptLabel = "__PLUGIN_NAME__";

  api.hooks.on("tenant:install", async ({ tenantId, host }) => {
    // Structure only on the workspace DB (Community: INSERT OR IGNORE structure_nodes IPC).
    const tenantDb = host.getTenantDb(tenantId);
    tenantDb
      .prepare(
        `INSERT OR IGNORE INTO structure_nodes
           (id, parent_id, label, icon, segment, kind, object_type, right_sidebar, agent_id, built_in, sort_order, tabs_json)
         VALUES (?, NULL, ?, 'folder', ?, 'placeholder', NULL, NULL, NULL, 0, 99, NULL)`
      )
      .run(deptId, deptLabel, deptId);
    tenantDb
      .prepare(
        `INSERT OR IGNORE INTO structure_nodes
           (id, parent_id, label, icon, segment, kind, object_type, right_sidebar, agent_id, built_in, sort_order, tabs_json)
         VALUES (?, ?, ?, 'sparkles', ?, ?, NULL, NULL, NULL, 0, 0, NULL)`
      )
      .run(
        `${deptId}-welcome`,
        deptId,
        "Welcome",
        `${deptId}-welcome`,
        `${PLUGIN_ID}-welcome`
      );
    tenantDb
      .prepare(
        `INSERT OR IGNORE INTO structure_nodes
           (id, parent_id, label, icon, segment, kind, object_type, right_sidebar, agent_id, built_in, sort_order, tabs_json)
         VALUES (?, ?, ?, 'list', ?, 'record-list', ?, NULL, NULL, 0, 1, NULL)`
      )
      .run(
        `${deptId}-items`,
        deptId,
        "Items",
        `${deptId}-items`,
        RECORD_TYPE
      );

    // Plugin business data: dedicated SQLite under plugin-data/{tenant}/{plugin}.sqlite
    const db = host.openPluginDb(PLUGIN_ID, tenantId);
    ensureDomainItemsTable(db);
  });

  // ObjectType facade over openPluginDb. Generated create_*/list_* tools prove the store.
  registerDomainSqliteObjectType(api, {
    pluginId: PLUGIN_ID,
    objectTypeName: RECORD_TYPE,
    label: `${deptLabel} Item`,
    labelPlural: `${deptLabel} Items`,
  });
};
