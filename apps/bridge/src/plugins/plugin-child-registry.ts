export type PluginChildHandle = {
  pid: number;
  kill: () => void;
  call: (method: string, params?: unknown) => Promise<unknown>;
};

const sessions = new Map<string, PluginChildHandle>();

export function registerPluginChild(
  pluginId: string,
  handle: PluginChildHandle
): void {
  sessions.get(pluginId)?.kill();
  sessions.set(pluginId, handle);
}

export function unregisterPluginChild(
  pluginId: string
): PluginChildHandle | undefined {
  const handle = sessions.get(pluginId);
  sessions.delete(pluginId);
  return handle;
}

export function getPluginChild(pluginId: string): PluginChildHandle | undefined {
  return sessions.get(pluginId);
}

export function pluginChildPid(pluginId: string): number | undefined {
  return sessions.get(pluginId)?.pid;
}
