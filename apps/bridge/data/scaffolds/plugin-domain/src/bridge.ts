import type { GodModePluginRegister } from "@godmode/plugin-api";

const PLUGIN_ID = "__PLUGIN_ID__";

export const register: GodModePluginRegister = (api) => {
  const deptId = "__DEPT_ID__";
  const deptLabel = "__PLUGIN_NAME__";

  api.hooks.on("tenant:install", async ({ tenantId, host }) => {
    // Structure only on the workspace DB (Community: INSERT OR IGNORE structure_nodes IPC).
    const tenantDb = host.getTenantDb(tenantId);
    tenantDb
      .prepare(
        `INSERT OR IGNORE INTO structure_nodes
           (id, parent_id, label, icon, segment, kind, right_sidebar, agent_id, built_in, sort_order, tabs_json)
         VALUES (?, NULL, ?, 'folder', ?, 'placeholder', NULL, NULL, 0, 99, NULL)`
      )
      .run(deptId, deptLabel, deptId);

    // Plugin business data: dedicated SQLite under plugin-data/{tenant}/{plugin}.sqlite
    const db = host.openPluginDb(PLUGIN_ID, tenantId) as import("better-sqlite3").Database;
    db.exec(`CREATE TABLE IF NOT EXISTS domain_items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    )`);
  });

  api.tools.register([
    {
      name: `${PLUGIN_ID}_list_items`,
      description: `List domain items for ${deptLabel}`,
      handler: async (_args, ctx) => {
        const db = ctx.host.openPluginDb(
          PLUGIN_ID,
          ctx.tenantId
        ) as import("better-sqlite3").Database;
        const rows = db
          .prepare(
            `SELECT id, title, body, updated_at FROM domain_items ORDER BY updated_at DESC LIMIT 50`
          )
          .all();
        return { ok: true, items: rows };
      },
    },
    {
      name: `${PLUGIN_ID}_add_item`,
      description: `Add a domain item for ${deptLabel}`,
      handler: async (args, ctx) => {
        const id =
          typeof args.id === "string" && args.id.trim()
            ? args.id.trim()
            : crypto.randomUUID();
        const title =
          typeof args.title === "string" && args.title.trim()
            ? args.title.trim()
            : "Untitled";
        const body = typeof args.body === "string" ? args.body : "";
        const db = ctx.host.openPluginDb(
          PLUGIN_ID,
          ctx.tenantId
        ) as import("better-sqlite3").Database;
        db.prepare(
          `INSERT INTO domain_items (id, title, body, updated_at)
           VALUES (?, ?, ?, datetime('now'))
           ON CONFLICT(id) DO UPDATE SET
             title=excluded.title,
             body=excluded.body,
             updated_at=excluded.updated_at`
        ).run(id, title, body);
        return { ok: true, id };
      },
    },
  ]);
};
