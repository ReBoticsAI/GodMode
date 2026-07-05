import { createElement, Fragment, type ComponentType, type ReactElement, type ReactNode } from "react";
import type {
  GodModeWebPluginApi,
  GodModeWebPluginRegister,
  PluginPageKindDef,
  PluginRedirectDef,
  PluginRootProviderDef,
  PluginRouteDef,
  PluginShellChrome,
  PluginShellSlot,
} from "@godmode/plugin-api";

export interface LoadedWebPlugin {
  id: string;
  version: string;
  name: string;
  routes: PluginRouteDef[];
  redirects: PluginRedirectDef[];
  pageKinds: PluginPageKindDef[];
  shellChrome: PluginShellChrome[];
  rootProviders: PluginRootProviderDef[];
}

class WebPluginRuntime {
  private readonly plugins: LoadedWebPlugin[] = [];
  private readonly extraRenderers = new Map<string, () => ReactElement>();

  register(manifest: { id: string; version: string; name: string }, registerFn: GodModeWebPluginRegister): void {
    const routes: PluginRouteDef[] = [];
    const redirects: PluginRedirectDef[] = [];
    const pageKinds: PluginPageKindDef[] = [];
    const shellChrome: PluginShellChrome[] = [];
    const rootProviders: PluginRootProviderDef[] = [];

    const api: GodModeWebPluginApi = {
      manifest,
      routes: {
        register(defs) {
          routes.push(...defs);
        },
        redirect(from, to) {
          redirects.push({ from, to });
        },
      },
      pageKinds: {
        register(kinds) {
          pageKinds.push(...kinds);
          for (const k of kinds) {
            const Comp = k.component;
            webPluginRuntime.extraRenderers.set(k.kind, () => createElement(Comp));
          }
        },
      },
      shell: {
        contribute(chrome) {
          shellChrome.push(...chrome);
        },
      },
      rootProviders: {
        register(providers) {
          rootProviders.push(...providers);
        },
      },
    };

    registerFn(api);
    this.plugins.push({
      id: manifest.id,
      version: manifest.version,
      name: manifest.name,
      routes,
      redirects,
      pageKinds,
      shellChrome,
      rootProviders,
    });
  }

  allRoutes(): PluginRouteDef[] {
    return this.plugins.flatMap((p) => p.routes);
  }

  allRedirects(): PluginRedirectDef[] {
    return this.plugins.flatMap((p) => p.redirects);
  }

  allShellChrome(): PluginShellChrome[] {
    return this.plugins.flatMap((p) => p.shellChrome);
  }

  shellForSidebar(rightSidebar: string | null | undefined): ComponentType | null {
    return this.shellForSlot(rightSidebar, "right");
  }

  shellForSlot(
    rightSidebar: string | null | undefined,
    slot: PluginShellSlot
  ): ComponentType | null {
    if (!rightSidebar) return null;
    for (const p of this.plugins) {
      for (const c of p.shellChrome) {
        const chromeSlot = c.slot ?? "right";
        if (c.rightSidebar === rightSidebar && chromeSlot === slot) return c.component;
      }
    }
    return null;
  }

  wrapWithRootProviders(children: ReactNode): ReactElement {
    let out: ReactNode = children;
    for (const p of this.plugins) {
      for (const provider of p.rootProviders) {
        const Provider = provider.component;
        out = createElement(Provider, null, out);
      }
    }
    return createElement(Fragment, null, out);
  }

  pageElement(kind: string, fallback: () => ReactElement): ReactElement {
    const fn = this.extraRenderers.get(kind);
    return fn ? fn() : fallback();
  }

  loadedIds(): string[] {
    return this.plugins.map((p) => p.id);
  }
}

export const webPluginRuntime = new WebPluginRuntime();

export type { PluginRouteDef, PluginRedirectDef, PluginShellChrome };
