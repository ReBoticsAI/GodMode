export {
  type GodmodePluginManifest,
  manifestPath,
  parseGodmodePluginManifest,
  readGodmodePluginManifest,
  pluginPathFromEnv,
} from "./manifest.js";

export {
  GODMODE_ENGINE_VERSION,
  assertEngineCompatible,
} from "./engine.js";

export {
  type GodModePluginApi,
  type GodModePluginRegister,
  type PluginBootContext,
  type PluginHookName,
  type PluginTenantContext,
  type PluginToolDef,
  type PluginToolHandler,
} from "./bridge-api.js";

export {
  type GodModeWebPluginApi,
  type GodModeWebPluginRegister,
  type PluginPageKindDef,
  type PluginRedirectDef,
  type PluginRootProviderDef,
  type PluginRouteDef,
  type PluginShellChrome,
  type PluginShellSlot,
  type PluginWebManifest,
} from "./web-api.js";

export type { PluginHostServices, TenantDb, SierraPb1SchedulerHost, SystemEventRow, CardAwaitingHost } from "./host-services.js";
