import type { GodModePluginRegister } from "@godmode/plugin-api";

const register: GodModePluginRegister = (api) => {
  api.tools.register([
    {
      name: "sandbox_ping",
      description: "Child-process sandbox ping and grant-gated fetch",
      handler: async (args, ctx) => {
        if (args.crash === true) {
          process.exit(1);
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
