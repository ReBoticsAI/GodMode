/**
 * Where plugin `register()` runs relative to Bridge.
 *
 * Today every trust tier is in-process `import()` (`loader.ts`).
 * Community Cloud installs are designed to move to a child process
 * (docs/PLUGIN_ISOLATION.md, #559). Official / local / operator stay
 * in-process until that runner is proven.
 */
import type { PluginTrustTier } from "../services/plugin-capabilities.js";

export type PluginRuntimeIsolation = "in-process" | "child-process";

export function pluginRuntimeIsolationForTrustTier(
  _trustTier: PluginTrustTier
): PluginRuntimeIsolation {
  return "in-process";
}
