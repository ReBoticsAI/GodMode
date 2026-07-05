import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function defaultPluginRoot(id: string): string {
  const base =
    process.env.GODMODE_PLUGIN_SCAFFOLD_DIR?.trim() ||
    path.join(os.homedir(), "godmode-plugins");
  return path.join(base, id);
}
export function scaffoldPlugin(opts: {
  id: string;
  name: string;
  departments?: string[];
}): { pluginRoot: string; created: boolean } {
  const id = opts.id.trim().replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  if (!id) throw new Error("Plugin id required");
  const pluginRoot = defaultPluginRoot(id);
  if (fs.existsSync(pluginRoot)) {
    return { pluginRoot, created: false };
  }
  fs.mkdirSync(path.join(pluginRoot, "src"), { recursive: true });
  const departments = opts.departments?.length ? opts.departments : [id];
  const manifest = {
    id,
    version: "0.1.0",
    name: opts.name.trim() || id,
    engine: "^0.1.0",
    departments,
    bridge: { entry: "dist/bridge.js" },
    web: { entry: "dist/web.js" },
  };
  fs.writeFileSync(
    path.join(pluginRoot, "godmode.plugin.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(pluginRoot, "package.json"),
    `${JSON.stringify(
      {
        name: `@godmode-plugin/${id}`,
        version: "0.1.0",
        private: true,
        type: "module",
        scripts: { build: "tsc -p tsconfig.json" },
        dependencies: {
          "@godmode/plugin-api": "workspace:*",
        },
        devDependencies: {
          typescript: "^5.0.0",
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(pluginRoot, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          outDir: "dist",
          rootDir: "src",
          strict: true,
          skipLibCheck: true,
        },
        include: ["src"],
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(pluginRoot, "src", "bridge.ts"),
    `import type { GodModePluginRegister } from "@godmode/plugin-api";

export const register: GodModePluginRegister = (api) => {
  const deptId = "${departments[0]}";
  const deptLabel = ${JSON.stringify(opts.name.trim() || id)};

  api.hooks.on("tenant:install", async ({ tenantId, host }) => {
    const db = host.getTenantDb(tenantId);
    db.prepare(
      \`INSERT OR IGNORE INTO structure_nodes
         (id, parent_id, label, icon, segment, kind, right_sidebar, agent_id, built_in, sort_order, tabs_json)
       VALUES (?, NULL, ?, 'folder', ?, 'placeholder', NULL, NULL, 0, 99, NULL)\`
    ).run(deptId, deptLabel, deptId);
    // Add divisions/pages here as the plugin grows
  });

  api.tools.register([
    {
      name: "${id}_hello",
      description: "Example tool from ${opts.name.replace(/"/g, '\\"')}",
      handler: async () => ({ ok: true, plugin: "${id}" }),
    },
  ]);
};
`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(pluginRoot, "src", "web.ts"),
    `import type { GodModeWebPluginRegister } from "@godmode/plugin-api";

export const registerWeb: GodModeWebPluginRegister = () => {
  /* Register web routes or sidebar entries */
};
`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(pluginRoot, "README.md"),
    `# ${opts.name}\n\nPrivate GodMode plugin. Add to \`GODMODE_PLUGIN_PATH\` and restart Bridge.\n`,
    "utf8"
  );
  return { pluginRoot, created: true };
}

export function prepareMarketplaceSubmission(opts: {
  id: string;
  title: string;
  description: string;
  kind?: string;
  installType?: "clone" | "plugin";
  pluginRepo?: string;
}): Record<string, unknown> {
  return {
    id: opts.id,
    kind: opts.kind ?? "plugin",
    installType: opts.installType ?? "plugin",
    title: opts.title,
    description: opts.description,
    version: "0.1.0",
    author: "community",
    pluginRepo: opts.pluginRepo,
    contributingUrl:
      "https://github.com/ReBoticsAI/GodMode-Marketplace/blob/main/CONTRIBUTING.md",
  };
}
