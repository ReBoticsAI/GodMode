import type { ComponentType, ReactNode } from "react";

export interface PluginRouteDef {
  path: string;
  element: ReactNode;
}

export interface PluginPageKindDef {
  kind: string;
  component: ComponentType;
}

export type PluginShellSlot = "right" | "header" | "footer";

export interface PluginShellChrome {
  id: string;
  /** When structure division has this rightSidebar value */
  rightSidebar?: string;
  slot?: PluginShellSlot;
  component: ComponentType;
}

export interface PluginRootProviderDef {
  id: string;
  component: ComponentType<{ children: ReactNode }>;
}

export interface PluginRedirectDef {
  from: string;
  to: string;
}

export interface GodModeWebPluginApi {
  readonly manifest: { id: string; version: string; name: string };

  routes: {
    register(routes: PluginRouteDef[]): void;
    redirect(from: string, to: string): void;
  };

  pageKinds: {
    register(kinds: PluginPageKindDef[]): void;
  };

  shell: {
    contribute(chrome: PluginShellChrome[]): void;
  };

  rootProviders: {
    register(providers: PluginRootProviderDef[]): void;
  };
}

export type GodModeWebPluginRegister = (api: GodModeWebPluginApi) => void;

export interface PluginWebManifest {
  id: string;
  version: string;
  name: string;
  webEntry?: string;
}
