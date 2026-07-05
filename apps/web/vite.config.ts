import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const bridgeHttp = process.env.BRIDGE_TARGET ?? "http://127.0.0.1:3847";
const bridgeWs = bridgeHttp.replace(/^http/, "ws");
const rootNodeModules = path.resolve(__dirname, "../../node_modules");

function importMapPlugin(): Plugin {
  const devImports = {
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

  const prodImports = {
    react: "/assets/react-vendor.js",
    "react/": "/assets/react-vendor.js",
    "react/jsx-runtime": "/assets/react-vendor.js",
    "react-dom": "/assets/react-dom-vendor.js",
    "react-dom/": "/assets/react-dom-vendor.js",
    "react-router-dom": "/assets/router-vendor.js",
    "lucide-react": "/assets/lucide-vendor.js",
    sonner: "/assets/sonner-vendor.js",
    "@xyflow/react": "/assets/xyflow-vendor.js",
    "@xyflow/react/dist/style.css": "/assets/xyflow-styles-vendor.js",
    "@godmode/web-host": "/assets/web-host-vendor.js",
    "@godmode/flow-core": "/assets/flow-core-vendor.js",
    recharts: "/assets/recharts-vendor.js",
    "use-sync-external-store/shim": "/assets/use-sync-external-store-shim-vendor.js",
    "use-sync-external-store/shim/with-selector":
      "/assets/use-sync-external-store-with-selector-vendor.js",
  };

  return {
    name: "godmode-import-map",
    configureServer(server) {
      server.middlewares.use("/vendor/es-module-shims.js", (_req, res, next) => {
        import("node:fs").then((fs) => {
          const file = path.join(rootNodeModules, "es-module-shims/dist/es-module-shims.js");
          if (!fs.existsSync(file)) {
            next();
            return;
          }
          res.setHeader("Content-Type", "application/javascript");
          fs.createReadStream(file).pipe(res);
        }).catch(next);
      });
    },
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        const imports = ctx.server ? devImports : prodImports;
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
        return { html, tags };
      },
    },
  };
}

const alias: Record<string, string> = {
  "@": path.resolve(__dirname, "./src"),
  "@godmode/web-host": path.resolve(__dirname, "../../packages/web-host/src/index.ts"),
  "@godmode/flow-core": path.resolve(__dirname, "../../packages/flow-core/src/index.ts"),
  "lucide-react": path.join(rootNodeModules, "lucide-react"),
  sonner: path.join(rootNodeModules, "sonner"),
  "@xyflow/react": path.join(rootNodeModules, "@xyflow/react"),
  recharts: path.join(rootNodeModules, "recharts"),
};

export default defineConfig({
  plugins: [react(), tailwindcss(), importMapPlugin()],
  resolve: { alias },
  optimizeDeps: {
    include: ["lucide-react", "sonner", "@xyflow/react", "recharts"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react-dom")) return "react-dom-vendor";
          if (id.includes("node_modules/react/") || id.endsWith("node_modules/react")) {
            return "react-vendor";
          }
          if (id.includes("react-router-dom")) return "router-vendor";
          if (id.includes("lucide-react")) return "lucide-vendor";
          if (id.includes("sonner")) return "sonner-vendor";
          if (id.includes("@xyflow/react")) return "xyflow-vendor";
          if (id.includes("packages/web-host")) return "web-host-vendor";
          if (id.includes("packages/flow-core")) return "flow-core-vendor";
          if (id.includes("recharts")) return "recharts-vendor";
          if (id.includes("xyflow-styles")) return "xyflow-styles-vendor";
        },
      },
    },
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
