import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/kernel/src/__tests__/**/*.test.ts",
      "packages/plugin-api/src/__tests__/**/*.test.ts",
      "apps/bridge/src/kernel/__tests__/**/*.test.ts",
      "apps/bridge/src/plugins/__tests__/route-hot-reload.test.ts",
      "apps/bridge/src/services/__tests__/marketplace-acquisition.test.ts",
      "apps/bridge/src/services/__tests__/marketplace-commerce.test.ts",
      "apps/bridge/src/routes/__tests__/marketplace-listings-query.test.ts",
      "apps/bridge/src/services/__tests__/release-flow.test.ts",
      "apps/bridge/src/services/__tests__/github-projects-status-map.test.ts",
      "apps/bridge/src/services/__tests__/multi-board-tasks-migration.test.ts",
      "apps/bridge/src/services/__tests__/prompt-assembler-order.test.ts",
      "apps/bridge/src/services/__tests__/cursor-cloud-transcript.test.ts",
      "apps/bridge/src/services/__tests__/delegation-timeout.test.ts",
      "apps/bridge/src/services/__tests__/saas-entitlements.test.ts",
      "apps/bridge/src/services/__tests__/saas-subscriptions.test.ts",
      "apps/bridge/src/services/auth/__tests__/mfa-and-tokens.test.ts",
      "apps/bridge/src/services/auth/__tests__/auth-security.http.test.ts",
      "apps/bridge/src/services/__tests__/feature-docs-images.test.ts",
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
