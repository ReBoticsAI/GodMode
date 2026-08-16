import type { GodModePluginRegister } from "@godmode/plugin-api";

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
