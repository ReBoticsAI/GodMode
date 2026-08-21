import type { GodModePluginRegister } from "@godmode/plugin-api";

const PLUGIN_ID = "community-sandbox";

const register: GodModePluginRegister = (api) => {
  api.hooks.on("tenant:install", async ({ tenantId, host }) => {
    const db = host.getTenantDb(tenantId);
    db.prepare(
      `INSERT OR IGNORE INTO structure_nodes
         (id, parent_id, label, icon, segment, kind, right_sidebar, agent_id, built_in, sort_order, tabs_json)
       VALUES (?, NULL, ?, 'activity', ?, 'placeholder', NULL, NULL, 0, 40, NULL)`
    ).run("workspace-pulse", "Workspace Pulse", "workspace-pulse");
    db.prepare(
      `INSERT OR IGNORE INTO structure_nodes
         (id, parent_id, label, icon, segment, kind, right_sidebar, agent_id, built_in, sort_order, tabs_json)
       VALUES (?, ?, ?, 'heart-pulse', ?, 'placeholder', NULL, NULL, 0, 0, NULL)`
    ).run("workspace-pulse-health", "workspace-pulse", "Health", "health");
    db.prepare(
      `INSERT OR IGNORE INTO structure_nodes
         (id, parent_id, label, icon, segment, kind, right_sidebar, agent_id, built_in, sort_order, tabs_json)
       VALUES (?, ?, ?, 'activity', ?, 'workspace-pulse', NULL, NULL, 0, 0, NULL)`
    ).run("workspace-pulse-pulse", "workspace-pulse-health", "Pulse", "pulse");

    const pluginDb = host.openPluginDb(PLUGIN_ID, tenantId) as import("better-sqlite3").Database;
    pluginDb.exec(`CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
  });

  api.tools.register([
    {
      name: "sandbox_ping",
      description: "Child-process sandbox ping and grant-gated fetch",
      handler: async (args, ctx) => {
        if (args.crash === true) {
          process.exit(1);
        }
        if (typeof args.sql === "string") {
          const db = ctx.host.getTenantDb(ctx.tenantId) as {
            prepare: (sql: string) => { run: (...params: unknown[]) => unknown };
          };
          db.prepare(args.sql).run(
            ...(Array.isArray(args.params) ? args.params : [])
          );
          return { ok: true, sql: true };
        }
        if (args.pluginDb === "write") {
          const db = ctx.host.openPluginDb(
            PLUGIN_ID,
            ctx.tenantId
          ) as import("better-sqlite3").Database;
          const id = typeof args.id === "string" ? args.id : "s1";
          const payload =
            typeof args.payload === "string"
              ? args.payload
              : JSON.stringify({ ping: true });
          db.prepare(
            `INSERT INTO sessions (id, payload_json, updated_at) VALUES (?, ?, datetime('now'))
             ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json, updated_at=excluded.updated_at`
          ).run(id, payload);
          return { ok: true, wrote: id };
        }
        if (args.pluginDb === "read") {
          const db = ctx.host.openPluginDb(
            PLUGIN_ID,
            ctx.tenantId
          ) as import("better-sqlite3").Database;
          const id = typeof args.id === "string" ? args.id : "s1";
          const row = db
            .prepare(`SELECT id, payload_json FROM sessions WHERE id = ?`)
            .get(id) as { id: string; payload_json: string } | undefined;
          return { ok: true, row: row ?? null };
        }
        if (args.pluginDb === "cross") {
          const other =
            typeof args.otherPluginId === "string"
              ? args.otherPluginId
              : "other-plugin";
          ctx.host.openPluginDb(other, ctx.tenantId);
          return { ok: true };
        }
        if (typeof args.url === "string") {
          const res = await ctx.host.externalFetch!(args.url);
          return { ok: true, status: res.status, body: await res.text() };
        }
        return { ok: true, plugin: api.manifest.id };
      },
    },
  ]);
};

export default register;
