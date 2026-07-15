export {
  type GodmodePluginManifest,
  type PluginRecordSeed,
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
  KERNEL_CLIENT_API_VERSION,
  type KernelClientApiVersion,
} from "./kernel-client.js";

export {
  type GodModePluginApi,
  type GodModePluginRegister,
  type PluginKernelClient,
  type PluginBootContext,
  type PluginHookName,
  type PluginTenantContext,
  type PluginToolDef,
  type PluginToolHandler,
  type PluginRecordContext,
  type PluginRecordQuery,
  type PluginRecordAdapter,
  type PluginRegistration,
} from "./bridge-api.js";

export {
  type GodModeWebPluginApi,
  type GodModeWebPluginRegister,
  type WebKernelActionOptions,
  type WebKernelClient,
  type PluginPageKindDef,
  type PluginRedirectDef,
  type PluginRootProviderDef,
  type PluginRouteDef,
  type PluginShellChrome,
  type PluginShellSlot,
  type PluginWebManifest,
} from "./web-api.js";

export type { PluginHostServices, TenantDb, SierraPb1SchedulerHost, SystemEventRow, CardAwaitingHost } from "./host-services.js";
