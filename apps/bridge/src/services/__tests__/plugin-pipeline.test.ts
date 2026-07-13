/**
 * Smoke: scaffold → esbuild → register/reload.
 * Run: npx tsx apps/bridge/src/services/__tests__/plugin-pipeline.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { EventEmitter } from "node:events";
import { setPluginHost } from "@godmode/plugin-host";
import { scaffoldPlugin, defaultPluginRoot } from "../plugin-scaffold.js";
import { buildPluginWithEsbuild, bridgeEntryExists } from "../plugin-build.js";
import { pluginRuntime } from "../../plugins/runtime.js";

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "gm-plugin-"));
process.env.GODMODE_PLUGIN_SCAFFOLD_DIR = tmpBase;

setPluginHost({
  getTenantDb: () => {
    throw new Error("not used in smoke");
  },
  getReqTenantDb: () => {
    throw new Error("not used in smoke");
  },
  createPluginRouter: () => {
    throw new Error("not used in smoke");
  },
  getTimeseriesStore: () => null,
  bootstrapTradingDepartment: () => undefined,
  bridgeFetch: async () => new Response(),
} as never);

const id = "pipeline-smoke";
const scaffold = scaffoldPlugin({ id, name: "Pipeline Smoke" });
assert.equal(scaffold.created, true);
assert.ok(fs.existsSync(path.join(scaffold.pluginRoot, "src", "bridge.ts")));
assert.equal(defaultPluginRoot(id), path.join(tmpBase, id));
assert.equal(scaffold.codingPath, `plugins/${id}`);

const pkg = JSON.parse(
  fs.readFileSync(path.join(scaffold.pluginRoot, "package.json"), "utf8")
);
assert.equal(pkg.dependencies?.["@godmode/plugin-api"], undefined);

const built = await buildPluginWithEsbuild(scaffold.pluginRoot);
assert.equal(built.ok, true);
assert.ok(bridgeEntryExists(scaffold.pluginRoot));
assert.ok(fs.existsSync(path.join(scaffold.pluginRoot, "dist", "bridge.js")));

pluginRuntime.configure({ operatorTenantId: "test", bus: new EventEmitter() });

const { pathToFileURL } = await import("node:url");
const entryUrl = pathToFileURL(
  path.join(scaffold.pluginRoot, "dist", "bridge.js")
).href;
const mod = (await import(entryUrl)) as {
  register?: (api: unknown) => void;
  default?: (api: unknown) => void;
};
const registerFn = mod.register ?? mod.default;
assert.equal(typeof registerFn, "function");

const { readGodmodePluginManifest } = await import("@godmode/plugin-api");
const manifest = readGodmodePluginManifest(scaffold.pluginRoot);
pluginRuntime.register(manifest, scaffold.pluginRoot, registerFn!);
assert.equal(pluginRuntime.hasPlugin(id), true);
assert.ok(pluginRuntime.getToolHandler(`${id}_hello`));

pluginRuntime.unregister(id);
assert.equal(pluginRuntime.hasPlugin(id), false);
assert.equal(pluginRuntime.getToolHandler(`${id}_hello`), undefined);

fs.rmSync(tmpBase, { recursive: true, force: true });
console.log("plugin-pipeline.test.ts: ok");
