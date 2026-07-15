import Database from "better-sqlite3";
import type { ObjectTypeDef } from "@godmode/kernel";
import { afterEach, describe, expect, it } from "vitest";
import type { OperationContext } from "../adapter-registry.js";
import {
  configurePlatformConfigAdapterServices,
  platformBillingConfigAdapter,
  resetPlatformConfigAdapterServices,
  tenantOnboardingConfigAdapter,
} from "../adapters/platform-config.js";

function definition(name: string, adapterId: string, fields: string[]): ObjectTypeDef {
  return {
    name,
    label: name,
    module: "platform",
    database: adapterId.includes("onboarding") ? "tenant" : "core",
    storage: { kind: "adapter", adapterId },
    fields: fields.map((name) => ({ name, label: name, fieldType: "Data" })),
    permissions: [{ role: "owner", read: true }],
    operations: ["list", "get"],
    contractVersion: 1,
    schemaVersion: 1,
  };
}

function context(
  db: Database.Database,
  tenantId: string,
  admin = false
): OperationContext {
  return {
    tenantId,
    userId: admin ? "admin" : `user-${tenantId}`,
    isAdmin: admin,
    role: "owner",
    source: "http",
    data: {
      tenantDb: db,
      coreDb: db,
      declaredDatabase: "tenant",
    },
  };
}

function tenantDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE ai_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE ai_secrets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

afterEach(() => resetPlatformConfigAdapterServices());

describe("platform configuration ObjectType adapters", () => {
  it("exposes billing capability without projecting the secret", async () => {
    const db = new Database(":memory:");
    let configuredSecret = "";
    configurePlatformConfigAdapterServices({
      getBillingConfig: () => ({
        configured: Boolean(configuredSecret),
        publishableKey: "pk_test_public",
        creditsPerUsd: 100,
        hasSecretKey: Boolean(configuredSecret),
      }),
      setBillingConfig(input) {
        configuredSecret = input.secretKey ?? configuredSecret;
        return {
          configured: Boolean(configuredSecret),
          publishableKey: input.publishableKey ?? "pk_test_public",
          creditsPerUsd: input.creditsPerUsd ?? 100,
          hasSecretKey: Boolean(configuredSecret),
        };
      },
      testBillingConnection: async () => ({ ok: true }),
    });
    const def = definition("PlatformBillingConfig", "platform_billing_config_service", [
      "id",
      "configured",
      "publishable_key",
      "credits_per_usd",
      "has_secret_key",
    ]);
    const ctx = context(db, "operator", true);

    const updated = platformBillingConfigAdapter.actions!.configure(
      db,
      def,
      "platform-billing",
      { secret_key: "sk_test_private" },
      ctx
    ) as { data: Record<string, unknown> };
    expect(configuredSecret).toBe("sk_test_private");
    expect(updated.data).not.toHaveProperty("secret_key");
    expect(updated.data).not.toHaveProperty("secret");
    await expect(
      platformBillingConfigAdapter.actions!.test_connection(
        db,
        def,
        "platform-billing",
        {},
        ctx
      )
    ).resolves.toEqual({ ok: true });
    db.close();
  });

  it("keeps onboarding completion tenant-local", () => {
    const a = tenantDb();
    const b = tenantDb();
    const def = definition(
      "TenantOnboardingConfig",
      "tenant_onboarding_config_service",
      ["id", "tenant_id", "completed", "llm_ready", "cursor_connected"]
    );

    tenantOnboardingConfigAdapter.actions!.complete(
      a,
      def,
      "tenant-a",
      {},
      context(a, "tenant-a")
    );
    const statusA = tenantOnboardingConfigAdapter.get!(
      a,
      def,
      "tenant-a",
      context(a, "tenant-a")
    );
    const statusB = tenantOnboardingConfigAdapter.get!(
      b,
      def,
      "tenant-b",
      context(b, "tenant-b")
    );
    expect(statusA?.data.completed).toBe(true);
    expect(statusB?.data.completed).toBe(false);
    expect(
      tenantOnboardingConfigAdapter.get!(
        b,
        def,
        "tenant-a",
        context(b, "tenant-b")
      )
    ).toBeNull();
    a.close();
    b.close();
  });
});
