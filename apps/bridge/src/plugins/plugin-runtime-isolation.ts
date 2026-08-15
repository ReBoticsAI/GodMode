/**
 * Where plugin `register()` runs relative to Bridge.
 *
 * Community marketplace installs run in a child process (#559).
 * Official / local / operator stay in-process until that runner is proven
 * for Official as well (docs/PLUGIN_ISOLATION.md).
 */
import type { PluginTrustTier } from "../services/plugin-capabilities.js";

export type PluginRuntimeIsolation = "in-process" | "child-process";

export function pluginRuntimeIsolationForTrustTier(
  trustTier: PluginTrustTier
): PluginRuntimeIsolation {
  return trustTier === "community" ? "child-process" : "in-process";
}
