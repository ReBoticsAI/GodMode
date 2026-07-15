import type {
  ActionDef,
  ObjectTypeDef,
  RecordData,
  RecordRow,
} from "@godmode/kernel";
import {
  getPlatformBillingConfig,
  setPlatformBillingKeys,
  testStripeConnection,
  type PlatformBillingConfig,
} from "../../services/platform-billing.js";
import {
  markLlmReady,
  markOnboardingComplete,
} from "../../services/onboarding.js";
import { isCursorSubscriptionReady } from "../../services/cursor-subscription.js";
import type { AppDatabase } from "../../db.js";
import type {
  OperationContext,
  RecordAdapter,
} from "../adapter-registry.js";

export interface PlatformConfigAdapterServices {
  getBillingConfig(): PlatformBillingConfig;
  setBillingConfig(input: {
    secretKey?: string;
    publishableKey?: string;
    creditsPerUsd?: number;
  }): PlatformBillingConfig;
  testBillingConnection(): Promise<{ ok: boolean; detail?: string }>;
  getOnboardingStatus?(tenantDb: AppDatabase): {
    completed: boolean;
    llmReady: boolean;
    cursorConnected?: boolean;
    llmStatus?: unknown;
  };
}

const defaultServices: PlatformConfigAdapterServices = {
  getBillingConfig: getPlatformBillingConfig,
  setBillingConfig: setPlatformBillingKeys,
  testBillingConnection: testStripeConnection,
};

let services = defaultServices;

/**
 * Parent startup wiring can provide the live LLM-aware onboarding status
 * closure without constructing another manager inside the kernel.
 */
export function configurePlatformConfigAdapterServices(
  next: Partial<PlatformConfigAdapterServices>
): void {
  services = { ...defaultServices, ...next };
}

export function resetPlatformConfigAdapterServices(): void {
  services = defaultServices;
}

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

function requireUser(ctx: OperationContext): string {
  if (!ctx.userId) throw httpError(401, "Authenticated user required");
  return ctx.userId;
}

function requireAdmin(ctx: OperationContext): void {
  requireUser(ctx);
  if (!ctx.isAdmin && ctx.source !== "system") {
    throw httpError(403, "Platform administrator required");
  }
}

function record(def: ObjectTypeDef, id: string, data: RecordData): RecordRow {
  return { id, objectType: def.name, data: { id, ...data } };
}

function billingRecord(def: ObjectTypeDef): RecordRow {
  const config = services.getBillingConfig();
  return record(def, "platform-billing", {
    configured: config.configured,
    publishable_key: config.publishableKey,
    credits_per_usd: config.creditsPerUsd,
    has_secret_key: config.hasSecretKey,
  });
}

export const platformBillingConfigAdapter: RecordAdapter = {
  id: "platform_billing_config_service",
  list(_core, def, _query, ctx) {
    requireAdmin(ctx);
    return {
      objectType: def.name,
      records: [billingRecord(def)],
      total: 1,
    };
  },
  get(_core, def, id, ctx) {
    requireAdmin(ctx);
    return id === "platform-billing" ? billingRecord(def) : null;
  },
  actions: {
    configure(_core, def, _id, input, ctx) {
      requireAdmin(ctx);
      services.setBillingConfig({
        secretKey:
          typeof input.secret_key === "string" ? input.secret_key : undefined,
        publishableKey:
          typeof input.publishable_key === "string"
            ? input.publishable_key
            : undefined,
        creditsPerUsd:
          typeof input.credits_per_usd === "number"
            ? input.credits_per_usd
            : undefined,
      });
      return billingRecord(def);
    },
    async test_connection(_core, _def, _id, _input, ctx) {
      requireAdmin(ctx);
      return services.testBillingConnection();
    },
  },
};

function readFlag(db: AppDatabase, key: string): boolean {
  const row = db
    .prepare(`SELECT value FROM ai_settings WHERE key=?`)
    .get(key) as { value: string } | undefined;
  return row?.value === "true";
}

function onboardingRecord(
  db: AppDatabase,
  def: ObjectTypeDef,
  ctx: OperationContext
): RecordRow {
  const tenantId = ctx.tenantId;
  if (!tenantId) throw httpError(403, "Tenant context required");
  const configured = services.getOnboardingStatus?.(db);
  const cursorConnected = configured?.cursorConnected ?? isCursorSubscriptionReady(db);
  return record(def, tenantId, {
    tenant_id: tenantId,
    completed:
      configured?.completed ?? readFlag(db, "onboarding.completed"),
    llm_ready:
      configured?.llmReady ??
      (readFlag(db, "onboarding.llm_ready") || cursorConnected),
    cursor_connected: cursorConnected,
    llm_status: configured?.llmStatus ?? null,
  });
}

export const tenantOnboardingConfigAdapter: RecordAdapter = {
  id: "tenant_onboarding_config_service",
  list(db, def, _query, ctx) {
    requireUser(ctx);
    return {
      objectType: def.name,
      records: [onboardingRecord(db, def, ctx)],
      total: 1,
    };
  },
  get(db, def, id, ctx) {
    requireUser(ctx);
    return id === ctx.tenantId ? onboardingRecord(db, def, ctx) : null;
  },
  actions: {
    complete(db, def, _id, _input, ctx) {
      requireUser(ctx);
      markOnboardingComplete(db);
      return onboardingRecord(db, def, ctx);
    },
    mark_llm_ready(db, def, _id, _input, ctx) {
      requireUser(ctx);
      markLlmReady(db);
      return onboardingRecord(db, def, ctx);
    },
  },
};

const schema = (
  properties: Record<string, unknown>,
  required: string[] = []
): Record<string, unknown> => ({
  type: "object",
  additionalProperties: false,
  properties,
  ...(required.length ? { required } : {}),
});

const action = (
  name: string,
  options: Partial<ActionDef> = {}
): ActionDef => ({
  name,
  label: name
    .split("_")
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" "),
  target: "record",
  effect: "write",
  execution: "sync",
  roles: ["owner", "intelligence"],
  inputSchema: schema({}),
  ...options,
});

export const PLATFORM_CONFIG_ACTIONS: Record<string, ActionDef[]> = {
  PlatformBillingConfig: [
    action("configure", {
      confirmation: { required: true },
      sensitiveInputPaths: ["secret_key"],
      inputSchema: schema({
        secret_key: { type: "string" },
        publishable_key: { type: "string" },
        credits_per_usd: { type: "number", minimum: 1 },
      }),
    }),
    action("test_connection", {
      effect: "external",
      execution: "async",
      cancellable: false,
      confirmation: { required: true },
    }),
  ],
  TenantOnboardingConfig: [
    action("complete"),
    action("mark_llm_ready"),
  ],
};

export const platformConfigAdapters = [
  platformBillingConfigAdapter,
  tenantOnboardingConfigAdapter,
] as const;
