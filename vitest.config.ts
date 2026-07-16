import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/kernel/src/__tests__/**/*.test.ts",
      "packages/plugin-api/src/__tests__/**/*.test.ts",
      "apps/bridge/src/kernel/__tests__/**/*.test.ts",
      "apps/bridge/src/services/__tests__/marketplace-acquisition.test.ts",
      "apps/bridge/src/services/__tests__/release-flow.test.ts",
      "apps/web/src/__tests__/**/*.test.ts",
      "apps/web/src/__tests__/**/*.test.tsx",
      "apps/web/src/pages/records/__tests__/**/*.test.tsx",
    ],
    environment: "node",
    globals: false,
    // Several suites exercise the singleton core database and its migrations.
    // Serial files prevent independent workers from racing the same schema.
    fileParallelism: false,
    restoreMocks: true,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
    },
  },
});
