import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const bridgeHttp = process.env.BRIDGE_TARGET ?? "http://127.0.0.1:3847";
const bridgeWs = bridgeHttp.replace(/^http/, "ws");
const rootNodeModules = path.resolve(__dirname, "../../node_modules");

function importMapPlugin(): Plugin {
  return {
    name: "godmode-import-map",
    apply: "build",
    transformIndexHtml(html) {
      return {
        html,
        tags: [
          {
            tag: "script",
            attrs: { type: "importmap" },
            children: JSON.stringify({
              imports: {
                react: "/assets/react-vendor.js",
                "react/": "/assets/react-vendor.js",
                "react-dom": "/assets/react-dom-vendor.js",
                "react-dom/": "/assets/react-dom-vendor.js",
                "react-router-dom": "/assets/router-vendor.js",
                "lucide-react": "/assets/lucide-vendor.js",
                sonner: "/assets/sonner-vendor.js",
                "@xyflow/react": "/assets/xyflow-vendor.js",
                "@godmode/web-host": "/assets/web-host-vendor.js",
              },
            }),
            injectTo: "head-prepend",
          },
        ],
      };
    },
  };
}

const alias: Record<string, string> = {
  "@": path.resolve(__dirname, "./src"),
  "@godmode/web-host": path.resolve(__dirname, "../../packages/web-host/src/index.ts"),
  "lucide-react": path.join(rootNodeModules, "lucide-react"),
  sonner: path.join(rootNodeModules, "sonner"),
  "@xyflow/react": path.join(rootNodeModules, "@xyflow/react"),
};

export default defineConfig({
  plugins: [react(), tailwindcss(), importMapPlugin()],
  resolve: { alias },
  optimizeDeps: {
    include: ["lucide-react", "sonner", "@xyflow/react"],
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
