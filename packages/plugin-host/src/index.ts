export type { PluginHostServices, TenantDb, SierraPb1SchedulerHost, SystemEventRow, CardAwaitingHost } from "@godmode/plugin-api";

import type { PluginHostServices } from "@godmode/plugin-api";

let hostImpl: PluginHostServices | null = null;

export function setPluginHost(services: PluginHostServices): void {
  hostImpl = services;
}

export function getPluginHost(): PluginHostServices {
  if (!hostImpl) {
    throw new Error("Plugin host not initialized — Bridge must call setPluginHost() before loading plugins");
  }
  return hostImpl;
}

export function tryGetPluginHost(): PluginHostServices | null {
  return hostImpl;
}
