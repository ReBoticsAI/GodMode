import fs from "node:fs";
import path from "node:path";
import { resolveCodingRoot, type FsRootOpts } from "./coding/fs-tools.js";
import {
  copyScaffoldTree,
  loadScaffoldBlueprint,
  pluginTemplateDir,
  scaffoldTokens,
  type PluginScaffoldTemplate,
} from "./architecture-scaffolds.js";

export interface ScaffoldRootOpts {
  tenantId?: string | null;
  /** Agent coding workspace subpath (Layer 2 worktree). */
  root?: string;
  isolatedDeployment?: boolean;
  tenantWorkspacesDir?: string;
}

/**
 * Canonical scaffold location — always under the coding root so edit_file works.
 * - Override: GODMODE_PLUGIN_SCAFFOLD_DIR/<id>
 * - Else: {resolveCodingRoot(...)}/plugins/<id> (tenant root or active worktree)
 */
export function pluginScaffoldBase(opts?: ScaffoldRootOpts): string {
  const override = process.env.GODMODE_PLUGIN_SCAFFOLD_DIR?.trim();
  if (override) return override;
  return path.join(resolveCodingRoot(opts as FsRootOpts), "plugins");
}

export function defaultPluginRoot(id: string, opts?: ScaffoldRootOpts): string {
  return path.join(pluginScaffoldBase(opts), id);
}

function normalizePluginTemplate(
  raw: string | undefined
): PluginScaffoldTemplate {
  const t = (raw ?? "domain").trim().toLowerCase();
  if (t === "records" || t === "record") return "records";
  return "domain";
}

export function scaffoldPlugin(opts: {
  id: string;
  name: string;
  departments?: string[];
  /** Architecture template: domain (openPluginDb, default) or records (Core ObjectTypes). */
  template?: string;
  tenantId?: string | null;
  root?: string;
  isolatedDeployment?: boolean;
  tenantWorkspacesDir?: string;
}): {
  pluginRoot: string;
  created: boolean;
  codingPath: string;
  template: PluginScaffoldTemplate;
} {
  const id = opts.id.trim().replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  if (!id) throw new Error("Plugin id required");
  const pluginRoot = defaultPluginRoot(id, {
    tenantId: opts.tenantId,
    root: opts.root,
    isolatedDeployment: opts.isolatedDeployment,
    tenantWorkspacesDir: opts.tenantWorkspacesDir,
  });
  const codingPath = `plugins/${id}`;
  const template = normalizePluginTemplate(opts.template);
  if (fs.existsSync(pluginRoot)) {
    return { pluginRoot, created: false, codingPath, template };
  }
  const departments = opts.departments?.length ? opts.departments : [id];
  const displayName = opts.name.trim() || id;
  const tokens = scaffoldTokens({
    id,
    name: displayName,
    deptId: departments[0]!,
  });
  copyScaffoldTree(pluginTemplateDir(template), pluginRoot, tokens);
  return { pluginRoot, created: true, codingPath, template };
}

export function prepareMarketplaceSubmission(opts: {
  id: string;
  title: string;
  description: string;
  kind?: string;
  installType?: "clone" | "plugin";
  pluginRepo?: string;
}): Record<string, unknown> {
  const base = loadScaffoldBlueprint("pack");
  return {
    ...base,
    id: opts.id,
    kind: opts.kind ?? base.kind ?? "plugin",
    installType: opts.installType ?? base.installType ?? "plugin",
    title: opts.title,
    description: opts.description,
    version: typeof base.version === "string" ? base.version : "0.1.0",
    author: typeof base.author === "string" ? base.author : "community",
    pluginRepo: opts.pluginRepo,
    contributingUrl:
      typeof base.contributingUrl === "string"
        ? base.contributingUrl
        : "https://github.com/ReBoticsAI/GodMode-Marketplace/blob/main/CONTRIBUTING.md",
  };
}

export {
  loadScaffoldBlueprint,
  type PluginScaffoldTemplate,
} from "./architecture-scaffolds.js";
