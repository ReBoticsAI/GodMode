import fs from "node:fs";
import path from "node:path";
import { config, tenantWorkspaceDir } from "../config.js";

export interface ScaffoldRootOpts {
  tenantId?: string | null;
}

/**
 * Canonical scaffold location — always under the coding root so edit_file works.
 * - Override: GODMODE_PLUGIN_SCAFFOLD_DIR/<id>
 * - Hub/client: {tenantWorkspace}/plugins/<id>
 * - Local: {repoRoot}/plugins/<id>
 */
export function pluginScaffoldBase(opts?: ScaffoldRootOpts): string {
  const override = process.env.GODMODE_PLUGIN_SCAFFOLD_DIR?.trim();
  if (override) return override;
  if (opts?.tenantId && (config.isHub || config.isClient)) {
    return path.join(tenantWorkspaceDir(opts.tenantId), "plugins");
  }
  return path.join(config.repoRoot, "plugins");
}

export function defaultPluginRoot(id: string, opts?: ScaffoldRootOpts): string {
  return path.join(pluginScaffoldBase(opts), id);
}

export function scaffoldPlugin(opts: {
  id: string;
  name: string;
  departments?: string[];
  tenantId?: string | null;
}): { pluginRoot: string; created: boolean; codingPath: string } {
  const id = opts.id.trim().replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  if (!id) throw new Error("Plugin id required");
  const pluginRoot = defaultPluginRoot(id, { tenantId: opts.tenantId });
  const codingPath = `plugins/${id}`;
  if (fs.existsSync(pluginRoot)) {
    return { pluginRoot, created: false, codingPath };
  }
  fs.mkdirSync(path.join(pluginRoot, "src"), { recursive: true });
  const departments = opts.departments?.length ? opts.departments : [id];
  const displayName = opts.name.trim() || id;
  const manifest = {
    id,
    version: "0.1.0",
    name: displayName,
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
        scripts: {
          build: "echo Use Intelligence build_plugin (Bridge esbuild) or tsc locally",
        },
        // Types come from Bridge host links at load time — no workspace:* / npm install.
        dependencies: {},
        devDependencies: {},
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
          noEmit: true,
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
  const deptLabel = ${JSON.stringify(displayName)};

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
      description: "Example tool from ${displayName.replace(/"/g, '\\"')}",
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
    `# ${displayName}

GodMode plugin scaffold.

## Activate (no Bridge restart)

1. Edit sources under \`${codingPath}/\`
2. Call Intelligence \`build_plugin\` (Bridge esbuild)
3. Call Intelligence \`install_plugin\` — loads at runtime and enables for your tenant

Same pipeline as Marketplace → Unofficial. Custom Express \`api.routes.mount\` after boot may still need a Bridge restart.
`,
    "utf8"
  );
  return { pluginRoot, created: true, codingPath };
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
