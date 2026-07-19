import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const bridgeHttp = process.env.BRIDGE_TARGET ?? "http://127.0.0.1:3847";
const bridgeWs = bridgeHttp.replace(/^http/, "ws");
const rootNodeModules = path.resolve(__dirname, "../../node_modules");

/** Specifier → stable `/plugin-shims/*.js` URL (production import map). */
const PROD_SHIM_IMPORTS: Record<string, string> = {
  react: "/plugin-shims/react.js",
  "react/": "/plugin-shims/react.js",
  "react/jsx-runtime": "/plugin-shims/react-jsx-runtime.js",
  "react-dom": "/plugin-shims/react-dom.js",
  "react-dom/": "/plugin-shims/react-dom.js",
  "react-router-dom": "/plugin-shims/react-router-dom.js",
  "lucide-react": "/plugin-shims/lucide-react.js",
  sonner: "/plugin-shims/sonner.js",
  "@xyflow/react": "/plugin-shims/xyflow-react.js",
  "@xyflow/react/dist/style.css": "/plugin-shims/xyflow-styles.js",
  "@godmode/web-host": "/plugin-shims/web-host.js",
  "@godmode/flow-core": "/plugin-shims/flow-core.js",
  recharts: "/plugin-shims/recharts.js",
  "use-sync-external-store/shim": "/plugin-shims/use-sync-external-store-shim.js",
  "use-sync-external-store/shim/with-selector":
    "/plugin-shims/use-sync-external-store-with-selector.js",
};

const DEV_IMPORTS: Record<string, string> = {
  react: "/src/plugin-vendor/react.ts",
  "react/": "/src/plugin-vendor/react.ts",
  "react/jsx-runtime": "/src/plugin-vendor/react-jsx-runtime.ts",
  "react-dom": "/src/plugin-vendor/react-dom.ts",
  "react-dom/": "/src/plugin-vendor/react-dom.ts",
  "react-router-dom": "/src/plugin-vendor/react-router-dom.ts",
  "lucide-react": "/src/plugin-vendor/lucide-react.ts",
  sonner: "/src/plugin-vendor/sonner.ts",
  "@xyflow/react": "/src/plugin-vendor/xyflow-react.ts",
  "@xyflow/react/dist/style.css": "/src/plugin-vendor/xyflow-styles.ts",
  "@godmode/web-host": "/src/plugin-vendor/web-host.ts",
  "@godmode/flow-core": "/src/plugin-vendor/flow-core.ts",
  recharts: "/src/plugin-vendor/recharts.ts",
  "use-sync-external-store/shim": "/src/plugin-vendor/use-sync-external-store-shim.ts",
  "use-sync-external-store/shim/with-selector":
    "/src/plugin-vendor/use-sync-external-store-with-selector.ts",
};

const SAFE_EXPORT = /^[A-Za-z_$][\w$]*$/;

function buildNamespaceShim(hostKey: string, exportNames: string[]): string {
  const names = exportNames.filter((k) => k !== "default" && SAFE_EXPORT.test(k));
  const lines = names.map((k) => `export const ${k} = m[${JSON.stringify(k)}];`);
  return `const m = globalThis.__godmodePluginHost?.[${JSON.stringify(hostKey)}];
if (!m) {
  throw new Error(${JSON.stringify(`${hostKey} shim: installPluginHostBridge() must run before plugin load`)});
}
${lines.join("\n")}
export default m.default ?? m;
`;
}

function handWrittenShims(): Record<string, string> {
  return {
    "web-host.js": `const m = globalThis.__godmodePluginHost?.["@godmode/web-host"];
if (!m) {
  throw new Error("@godmode/web-host shim: installPluginHostBridge() must run before plugin load");
}
export const cn = m.cn;
export const StructureTabGroupPage = m.StructureTabGroupPage;
export const pageElementFor = m.pageElementFor;
export const webPluginRuntime = m.webPluginRuntime;
`,
    "react.js": `const React = globalThis.__godmodePluginHost?.react;
if (!React) throw new Error("react shim: installPluginHostBridge() must run before plugin load");
export const {
  Children, Component, Fragment, Profiler, PureComponent, StrictMode, Suspense,
  cloneElement, createContext, createElement, createRef, forwardRef, isValidElement,
  lazy, memo, startTransition, useCallback, useContext, useDebugValue, useDeferredValue,
  useEffect, useId, useImperativeHandle, useInsertionEffect, useLayoutEffect, useMemo,
  useReducer, useRef, useState, useSyncExternalStore, useTransition, version,
} = React;
export const useActionState = React.useActionState;
export const useOptimistic = React.useOptimistic;
export default React;
`,
    "react-jsx-runtime.js": `const Jsx = globalThis.__godmodePluginHost?.["react/jsx-runtime"];
if (!Jsx) throw new Error("react/jsx-runtime shim: installPluginHostBridge() must run before plugin load");
export const jsx = Jsx.jsx;
export const jsxs = Jsx.jsxs;
export const Fragment = Jsx.Fragment;
`,
    "react-dom.js": `const ReactDOM = globalThis.__godmodePluginHost?.["react-dom"];
if (!ReactDOM) throw new Error("react-dom shim: installPluginHostBridge() must run before plugin load");
export const { createPortal, flushSync, createRoot, hydrateRoot, version } = ReactDOM;
export default ReactDOM;
`,
    "use-sync-external-store-shim.js": `const m = globalThis.__godmodePluginHost?.["use-sync-external-store/shim"];
if (!m) throw new Error("use-sync-external-store/shim: installPluginHostBridge() must run before plugin load");
export const useSyncExternalStore = m.useSyncExternalStore;
`,
    "use-sync-external-store-with-selector.js": `const m = globalThis.__godmodePluginHost?.["use-sync-external-store/shim/with-selector"];
if (!m) throw new Error("use-sync-external-store/shim/with-selector: installPluginHostBridge() must run before plugin load");
export const useSyncExternalStoreWithSelector = m.useSyncExternalStoreWithSelector;
`,
    "xyflow-styles.js": `/* Host app already loads @xyflow/react CSS; no-op for the import map. */
`,
  };
}

function exportNamesFor(packageId: string): string[] {
  try {
    const mod = require(packageId) as Record<string, unknown>;
    return Object.keys(mod);
  } catch {
    return [];
  }
}

function pluginShimPlugin(): Plugin {
  return {
    name: "godmode-plugin-shims",
    closeBundle() {
      const outDir = path.resolve(__dirname, "dist/plugin-shims");
      fs.mkdirSync(outDir, { recursive: true });

      for (const [file, source] of Object.entries(handWrittenShims())) {
        fs.writeFileSync(path.join(outDir, file), source);
      }

      const namespaces: Array<{ file: string; hostKey: string; id: string }> = [
        { file: "react-router-dom.js", hostKey: "react-router-dom", id: "react-router-dom" },
        { file: "lucide-react.js", hostKey: "lucide-react", id: "lucide-react" },
        { file: "sonner.js", hostKey: "sonner", id: "sonner" },
        { file: "xyflow-react.js", hostKey: "@xyflow/react", id: "@xyflow/react" },
        { file: "flow-core.js", hostKey: "@godmode/flow-core", id: "@godmode/flow-core" },
        { file: "recharts.js", hostKey: "recharts", id: "recharts" },
      ];

      for (const entry of namespaces) {
        fs.writeFileSync(
          path.join(outDir, entry.file),
          buildNamespaceShim(entry.hostKey, exportNamesFor(entry.id))
        );
      }
    },
  };
}

function importMapPlugin(): Plugin {
  return {
    name: "godmode-import-map",
    configureServer(server) {
      server.middlewares.use("/vendor/es-module-shims.js", (_req, res, next) => {
        import("node:fs")
          .then((fsMod) => {
            const file = path.join(rootNodeModules, "es-module-shims/dist/es-module-shims.js");
            if (!fsMod.existsSync(file)) {
              next();
              return;
            }
            res.setHeader("Content-Type", "application/javascript");
            fsMod.createReadStream(file).pipe(res);
          })
          .catch(next);
      });
    },
    transformIndexHtml: {
      order: "pre",
      handler(_html, ctx) {
        const imports = ctx.server ? DEV_IMPORTS : PROD_SHIM_IMPORTS;
        const tags: Array<Record<string, unknown>> = [];
        if (ctx.server) {
          tags.push({
            tag: "script",
            attrs: { async: true, src: "/vendor/es-module-shims.js" },
            injectTo: "head-prepend",
          });
        }
        tags.push({
          tag: "script",
          attrs: { type: "importmap", "data-godmode-importmap": "true" },
          children: JSON.stringify({ imports }),
          injectTo: "head-prepend",
        });
        return { tags };
      },
    },
  };
}

const alias: Record<string, string> = {
  "@": path.resolve(__dirname, "./src"),
  // Dev facade; production plugins use /plugin-shims/web-host.js via import map.
  "@godmode/web-host": path.resolve(__dirname, "./src/plugin-vendor/web-host.ts"),
  "@godmode/flow-core": path.resolve(__dirname, "../../packages/flow-core/src/index.ts"),
  "@product-docs": path.resolve(__dirname, "../../docs/features"),
  "lucide-react": path.join(rootNodeModules, "lucide-react"),
  sonner: path.join(rootNodeModules, "sonner"),
  "@xyflow/react": path.join(rootNodeModules, "@xyflow/react"),
  recharts: path.join(rootNodeModules, "recharts"),
};

export default defineConfig({
  plugins: [react(), tailwindcss(), importMapPlugin(), pluginShimPlugin()],
  resolve: { alias },
  assetsInclude: ["**/*.md"],
  optimizeDeps: {
    include: ["lucide-react", "sonner", "@xyflow/react", "recharts"],
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, "../..")],
    },
    host: true,
    port: 5173,
    allowedHosts: true,
    proxy: {
      "/api": { target: bridgeHttp, changeOrigin: true },
      "/ws": { target: bridgeWs, ws: true },
    },
  },
});
