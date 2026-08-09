/**
 * Bridge-owned plugin compile (esbuild). Avoids per-plugin npm install and
 * monorepo `workspace:*` deps so scaffolds work on Docker hub and local alike.
 */
import fs from "node:fs";
import path from "node:path";
import * as esbuild from "esbuild";
import { readGodmodePluginManifest } from "@godmode/plugin-api";
import {
  assertDeployAllowed,
  isDeployAuthorityError,
  type DeployAssertOpts,
} from "./authority/deploy-authority.js";
import { PluginLoopError } from "./plugin-loop-error.js";

const BRIDGE_EXTERNAL = ["@godmode/plugin-api", "@godmode/plugin-host"];

/** Host import-map modules: must not be bundled into plugin dist/web.js. */
const WEB_EXTERNAL = [
  ...BRIDGE_EXTERNAL,
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-router-dom",
  "lucide-react",
  "sonner",
  "@godmode/web-host",
];

export type PluginBuildAuthorityOpts = DeployAssertOpts;

function resolveSource(pluginRoot: string, baseName: string): string | null {
  const candidates = [
    path.join(pluginRoot, "src", `${baseName}.ts`),
    path.join(pluginRoot, "src", `${baseName}.tsx`),
    path.join(pluginRoot, "src", baseName, "index.ts"),
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

export function bridgeEntryExists(pluginRoot: string): boolean {
  const manifest = readGodmodePluginManifest(pluginRoot);
  const entry = manifest.bridge?.entry ?? "dist/bridge.js";
  const candidates = [
    path.join(pluginRoot, entry),
    path.join(pluginRoot, entry.replace(/\.js$/, ".ts")),
    path.join(pluginRoot, "src/bridge/index.ts"),
  ];
  return candidates.some((c) => fs.existsSync(c));
}

export async function buildPluginWithEsbuild(
  pluginRoot: string,
  authority?: PluginBuildAuthorityOpts
): Promise<{ ok: true; pluginRoot: string; outputs: string[] }> {
  assertDeployAllowed({
    tenantId: authority?.tenantId,
    userId: authority?.userId,
    agentId: authority?.agentId,
    action: authority?.action ?? "build_plugin",
  });
  try {
    return await buildPluginWithEsbuildUnchecked(pluginRoot);
  } catch (err) {
    if (isDeployAuthorityError(err) || err instanceof PluginLoopError) throw err;
    throw new PluginLoopError(
      "build",
      err instanceof Error ? err.message : String(err)
    );
  }
}

async function buildPluginWithEsbuildUnchecked(
  pluginRoot: string
): Promise<{ ok: true; pluginRoot: string; outputs: string[] }> {
  const resolved = path.resolve(pluginRoot);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new PluginLoopError("build", `Plugin root not found: ${resolved}`);
  }

  let manifest;
  try {
    manifest = readGodmodePluginManifest(resolved);
  } catch (err) {
    throw new PluginLoopError(
      "manifest",
      err instanceof Error ? err.message : String(err)
    );
  }
  const bridgeOut = path.join(resolved, manifest.bridge?.entry ?? "dist/bridge.js");
  const webOut = path.join(resolved, manifest.web?.entry ?? "dist/web.js");
  const outputs: string[] = [];

  const bridgeSrc = resolveSource(resolved, "bridge");
  if (!bridgeSrc) {
    throw new PluginLoopError("build", `No src/bridge.ts found under ${resolved}`);
  }

  fs.mkdirSync(path.dirname(bridgeOut), { recursive: true });
  await esbuild.build({
    entryPoints: [bridgeSrc],
    outfile: bridgeOut,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: BRIDGE_EXTERNAL,
    logLevel: "silent",
  });
  outputs.push(bridgeOut);

  const webSrc = resolveSource(resolved, "web");
  if (webSrc) {
    fs.mkdirSync(path.dirname(webOut), { recursive: true });
    await esbuild.build({
      entryPoints: [webSrc],
      outfile: webOut,
      bundle: true,
      platform: "browser",
      format: "esm",
      target: "es2022",
      jsx: "automatic",
      external: WEB_EXTERNAL,
      logLevel: "silent",
    });
    outputs.push(webOut);
  }

  if (!bridgeEntryExists(resolved)) {
    throw new PluginLoopError(
      "build",
      "Plugin build finished but bridge entry is still missing."
    );
  }

  return { ok: true, pluginRoot: resolved, outputs };
}

/** Build if dist entry missing; used by Marketplace Unofficial and Intelligence. */
export async function ensurePluginBuilt(
  pluginRoot: string,
  authority?: PluginBuildAuthorityOpts
): Promise<boolean> {
  if (bridgeEntryExists(pluginRoot)) return false;
  await buildPluginWithEsbuild(pluginRoot, authority);
  return true;
}
