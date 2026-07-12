/**
 * Shared modules the production plugin import map resolves through
 * `/plugin-shims/*.js`.
 *
 * Plugins must receive the **same** React / registry instances as the host app.
 * Rollup vendor chunks cannot expose stable named exports for an external
 * import map, so the host installs live module objects here and shim files
 * re-export them.
 */
import * as React from "react";
import * as ReactJsxRuntime from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as ReactRouterDom from "react-router-dom";
import * as LucideReact from "lucide-react";
import * as Sonner from "sonner";
import * as XyflowReact from "@xyflow/react";
import * as FlowCore from "@godmode/flow-core";
import * as Recharts from "recharts";
import { useSyncExternalStore } from "use-sync-external-store/shim";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/shim/with-selector";
import { cn } from "../../../../packages/web-host/src/index";
import { StructureTabGroupPage } from "@/components/StructureTabGroupPage";
import { pageElementFor } from "@/lib/page-registry";
import { webPluginRuntime } from "@/plugins/runtime";

export type GodModePluginHost = {
  react: typeof React;
  "react/jsx-runtime": typeof ReactJsxRuntime;
  "react-dom": typeof ReactDOM & typeof ReactDOMClient;
  "react-router-dom": typeof ReactRouterDom;
  "lucide-react": typeof LucideReact;
  sonner: typeof Sonner;
  "@xyflow/react": typeof XyflowReact;
  "@godmode/web-host": {
    cn: typeof cn;
    StructureTabGroupPage: typeof StructureTabGroupPage;
    pageElementFor: typeof pageElementFor;
    webPluginRuntime: typeof webPluginRuntime;
  };
  "@godmode/flow-core": typeof FlowCore;
  recharts: typeof Recharts;
  "use-sync-external-store/shim": { useSyncExternalStore: typeof useSyncExternalStore };
  "use-sync-external-store/shim/with-selector": {
    useSyncExternalStoreWithSelector: typeof useSyncExternalStoreWithSelector;
  };
};

declare global {
  interface Window {
    __godmodePluginHost?: GodModePluginHost;
  }
}

export function installPluginHostBridge(): void {
  if (typeof window === "undefined") return;
  if (window.__godmodePluginHost) return;

  window.__godmodePluginHost = {
    react: React,
    "react/jsx-runtime": ReactJsxRuntime,
    "react-dom": { ...ReactDOM, ...ReactDOMClient },
    "react-router-dom": ReactRouterDom,
    "lucide-react": LucideReact,
    sonner: Sonner,
    "@xyflow/react": XyflowReact,
    "@godmode/web-host": {
      cn,
      StructureTabGroupPage,
      pageElementFor,
      webPluginRuntime,
    },
    "@godmode/flow-core": FlowCore,
    recharts: Recharts,
    "use-sync-external-store/shim": { useSyncExternalStore },
    "use-sync-external-store/shim/with-selector": { useSyncExternalStoreWithSelector },
  };
}
