import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AppDatabase } from "../db.js";
import type { CoreDatabase } from "../core-db.js";
import { getCloudDb } from "../core-db.js";
import { ensureTrialInferenceTables } from "./trial-inference-schema.js";
import {
  OPENROUTER_API_BASE_URL,
  OPENROUTER_TOP10_CATALOG,
  upsertOpenRouterApiKey,
} from "./openrouter-platform.js";
import { markLlmReady } from "./onboarding.js";
import { selectIntelligenceModel } from "./model-catalog.js";
import type { LlmManager } from "./llm-manager.js";

/** Exact first-land Intelligence greeting (UI may seed this without a model turn). */
export const FIRST_LAND_GREETING =
  "Hey, you're in control. Put us to work.";

/** Greeting-capable default from the OpenRouter catalog (#758). */
export const TRIAL_DEFAULT_MODEL_ID =
  OPENROUTER_TOP10_CATALOG[0]?.id ?? "deepseek/deepseek-v4-flash-0731";

export type TrialProvisionMechanism =
  | "mgmtApi"
  | "platformShared"
  | "browser"
  | "computerUse"
  | "terminal"
  | "none";

export type TrialGrantStatus =
  | "active"
  | "converted"
  | "expired"
  | "revoked"
  | "failed"
  | "unconfigured"
  | "deferred_until_auth"
  | "deferred_mechanism";

export interface TrialInferenceStatus {
  ready: boolean;
  mechanism: TrialProvisionMechanism;
  modelId: string;
  greeting: string;
  status: TrialGrantStatus;
  expiresAt: string | null;
  promptThreshold: number;
  ttlDays: number;
  detail?: string;
  configured: {
    mgmtApi: boolean;
    platformShared: boolean;
  };
  /** Remaining ops for full #758 mint / convert (not built in this slice). */
  remainingOps: string[];
}

export interface EnsureTrialInferenceOpts {
  userId?: string | null;
  visitorKey?: string | null;
  /** Client IP for soft visitor heuristics / rate subject (hashed, not stored raw). */
  clientIp?: string | null;
  tenantDb?: AppDatabase | null;
  llm?: LlmManager | null;
  /** When true, attempt mint / vault attach (authenticated path). */
  provision?: boolean;
  fetchImpl?: typeof fetch;
  now?: Date;
  db?: CoreDatabase;
}

function readEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

function parseOrder(): TrialProvisionMechanism[] {
  const raw = readEnv("TRIAL_PROVISION_ORDER") || "mgmtApi,platformShared";
  const allowed = new Set<TrialProvisionMechanism>([
    "mgmtApi",
    "platformShared",
    "browser",
    "computerUse",
    "terminal",
  ]);
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is TrialProvisionMechanism =>
      allowed.has(s as TrialProvisionMechanism)
    );
  return parts.length ? parts : ["mgmtApi", "platformShared"];
}

export function trialInferenceConfig() {
  const ttlDays = Math.max(1, Number(readEnv("TRIAL_KEY_TTL_DAYS") || 30));
  const budgetUsd = Math.max(
    0.1,
    Number(readEnv("TRIAL_INFERENCE_BUDGET_USD") || 5)
  );
  const promptThreshold = Math.max(
    1,
    Number(readEnv("TRIAL_PROMPT_THRESHOLD") || 5)
  );
  const modelId = readEnv("TRIAL_DEFAULT_MODEL_ID") || TRIAL_DEFAULT_MODEL_ID;
  const mgmtKey = readEnv("OPENROUTER_MANAGEMENT_API_KEY");
  const platformKey =
    readEnv("TRIAL_PLATFORM_API_KEY") || readEnv("OPENROUTER_API_KEY");
  const allowVisitorMint = readEnv("TRIAL_ALLOW_VISITOR_MINT") === "true";
  const cloudTrialUrl = readEnv("CLOUD_TRIAL_URL");
  return {
    ttlDays,
    budgetUsd,
    promptThreshold,
    modelId,
    mgmtKey,
    platformKey,
    allowVisitorMint,
    cloudTrialUrl,
    order: parseOrder(),
  };
}

export function hashTrialSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function newVisitorKey(): string {
  return `v_${randomBytes(16).toString("hex")}`;
}

export function subjectKeyFor(opts: {
  userId?: string | null;
  visitorKey?: string | null;
  clientIp?: string | null;
}): string {
  if (opts.userId) return `user:${opts.userId}`;
  const visitor = opts.visitorKey?.trim() || "anon";
  const ipHash = hashTrialSecret(opts.clientIp?.trim() || "unknown-ip").slice(
    0,
    16
  );
  return `visitor:${visitor}:${ipHash}`;
}

function remainingOpsNote(cfg: ReturnType<typeof trialInferenceConfig>): string[] {
  const notes: string[] = [];
  if (!cfg.mgmtKey) {
    notes.push(
      "Set OPENROUTER_MANAGEMENT_API_KEY for per-user OpenRouter Management API mint (POST /api/v1/keys)."
    );
  }
  if (!cfg.platformKey) {
    notes.push(
      "Set TRIAL_PLATFORM_API_KEY (or OPENROUTER_API_KEY) for shared platform trial fallback."
    );
  }
  notes.push(
    "Browser / computerUse / terminal provisioners are deferred (see GitHub #758)."
  );
  notes.push(
    "Prompt-threshold convert playbook + key revoke/expiry job remain on #758."
  );
  notes.push(
    "Full unlock tutorial cascade and 3D WebGL canvas are separate tracks (not this slice)."
  );
  return notes;
}

function baseStatus(
  partial: Partial<TrialInferenceStatus> &
    Pick<TrialInferenceStatus, "ready" | "mechanism" | "status">
): TrialInferenceStatus {
  const cfg = trialInferenceConfig();
  return {
    ready: partial.ready,
    mechanism: partial.mechanism,
    modelId: partial.modelId ?? cfg.modelId,
    greeting: FIRST_LAND_GREETING,
    status: partial.status,
    expiresAt: partial.expiresAt ?? null,
    promptThreshold: cfg.promptThreshold,
    ttlDays: cfg.ttlDays,
    detail: partial.detail,
    configured: {
      mgmtApi: Boolean(cfg.mgmtKey),
      platformShared: Boolean(cfg.platformKey),
    },
    remainingOps: remainingOpsNote(cfg),
  };
}

function readActiveGrant(
  db: CoreDatabase,
  subject: string
): {
  mechanism: TrialProvisionMechanism;
  model_id: string;
  expires_at: string | null;
  status: string;
} | null {
  ensureTrialInferenceTables(db);
  const row = db
    .prepare(
      `SELECT mechanism, model_id, expires_at, status
       FROM trial_inference_grants WHERE subject_key=?`
    )
    .get(subject) as
    | {
        mechanism: TrialProvisionMechanism;
        model_id: string;
        expires_at: string | null;
        status: string;
      }
    | undefined;
  if (!row) return null;
  if (row.status !== "active") return null;
  if (row.expires_at && Date.parse(row.expires_at) < Date.now()) {
    db.prepare(
      `UPDATE trial_inference_grants SET status='expired', updated_at=datetime('now')
       WHERE subject_key=?`
    ).run(subject);
    return null;
  }
  return row;
}

function upsertGrant(
  db: CoreDatabase,
  opts: {
    subjectKey: string;
    userId?: string | null;
    visitorKey?: string | null;
    mechanism: TrialProvisionMechanism;
    modelId: string;
    expiresAt: string;
    providerKeyHash?: string | null;
    providerKeyId?: string | null;
  }
): void {
  ensureTrialInferenceTables(db);
  const id = randomUUID();
  db.prepare(
    `INSERT INTO trial_inference_grants (
       id, subject_key, user_id, visitor_key, provider, mechanism, status,
       model_id, provider_key_hash, provider_key_id, expires_at
     ) VALUES (?, ?, ?, ?, 'openrouter', ?, 'active', ?, ?, ?, ?)
     ON CONFLICT(subject_key) DO UPDATE SET
       user_id=excluded.user_id,
       visitor_key=excluded.visitor_key,
       mechanism=excluded.mechanism,
       status='active',
       model_id=excluded.model_id,
       provider_key_hash=COALESCE(excluded.provider_key_hash, provider_key_hash),
       provider_key_id=COALESCE(excluded.provider_key_id, provider_key_id),
       expires_at=excluded.expires_at,
       updated_at=datetime('now')`
  ).run(
    id,
    opts.subjectKey,
    opts.userId ?? null,
    opts.visitorKey ?? null,
    opts.mechanism,
    opts.modelId,
    opts.providerKeyHash ?? null,
    opts.providerKeyId ?? null,
    opts.expiresAt
  );
}

async function mintOpenRouterKeyViaMgmtApi(opts: {
  name: string;
  limitUsd: number;
  expiresAt: string;
  mgmtKey: string;
  fetchImpl: typeof fetch;
}): Promise<{ key: string; hash?: string; id?: string }> {
  const res = await opts.fetchImpl("https://openrouter.ai/api/v1/keys", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.mgmtKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: opts.name,
      limit: opts.limitUsd,
      expires_at: opts.expiresAt,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    data?: { key?: string; hash?: string; id?: string };
    key?: string;
    hash?: string;
    id?: string;
    error?: { message?: string };
  };
  if (!res.ok) {
    const msg =
      body.error?.message ||
      `OpenRouter Management API mint failed (${res.status})`;
    throw Object.assign(new Error(msg), { status: res.status });
  }
  const key = body.data?.key ?? body.key;
  if (!key) {
    throw Object.assign(
      new Error("OpenRouter Management API returned no key"),
      { status: 502 }
    );
  }
  return {
    key,
    hash: body.data?.hash ?? body.hash,
    id: body.data?.id ?? body.id,
  };
}

async function applyTrialToWorkspace(opts: {
  tenantDb: AppDatabase;
  apiKey: string;
  modelId: string;
  llm?: LlmManager | null;
}): Promise<void> {
  upsertOpenRouterApiKey(opts.tenantDb, opts.apiKey);
  markLlmReady(opts.tenantDb);
  if (opts.llm) {
    try {
      await selectIntelligenceModel(opts.tenantDb, opts.llm, {
        source: "provider",
        model: opts.modelId,
        provider: "openai_compatible",
        transport: "openrouter",
        baseUrl: OPENROUTER_API_BASE_URL,
      });
    } catch {
      // Soft-fail model select: key is vaulted and llmReady is set; user can pick in UI.
    }
  }
}

/**
 * Probe or provision trial inference for a first-land visitor or signed-in user.
 * Does not scrape affiliate UIs. Management API mint requires a management key;
 * platform shared key is the graceful fallback when configured.
 */
export async function ensureTrialInference(
  opts: EnsureTrialInferenceOpts = {}
): Promise<TrialInferenceStatus> {
  const cfg = trialInferenceConfig();
  const db = opts.db ?? getCloudDb();
  const now = opts.now ?? new Date();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const subject = subjectKeyFor({
    userId: opts.userId,
    visitorKey: opts.visitorKey,
    clientIp: opts.clientIp,
  });
  const expiresAt = new Date(
    now.getTime() + cfg.ttlDays * 24 * 60 * 60 * 1000
  ).toISOString();

  const existing = readActiveGrant(db, subject);
  if (existing) {
    return baseStatus({
      ready: true,
      mechanism: existing.mechanism,
      modelId: existing.model_id,
      status: "active",
      expiresAt: existing.expires_at,
      detail: "Existing trial grant reused.",
    });
  }

  const provision = opts.provision !== false;
  const canMintForSubject = Boolean(opts.userId) || cfg.allowVisitorMint;

  if (!cfg.mgmtKey && !cfg.platformKey) {
    return baseStatus({
      ready: false,
      mechanism: "none",
      status: "unconfigured",
      detail:
        "Trial inference is not configured. Set OPENROUTER_MANAGEMENT_API_KEY and/or TRIAL_PLATFORM_API_KEY. See GitHub #758.",
    });
  }

  // Pre-auth visitors: report readiness of platform shared path without minting
  // orphan per-IP keys (unless TRIAL_ALLOW_VISITOR_MINT=true).
  if (!opts.userId && !cfg.allowVisitorMint) {
    if (cfg.platformKey) {
      return baseStatus({
        ready: true,
        mechanism: "platformShared",
        status: "deferred_until_auth",
        expiresAt,
        detail:
          "Platform trial key is configured. Per-user mint and Vault attach run after sign-in (GitHub #758).",
      });
    }
    return baseStatus({
      ready: false,
      mechanism: "mgmtApi",
      status: "deferred_until_auth",
      detail:
        "Management API mint waits for a signed-in GodMode user. Greeting still shows client-side.",
    });
  }

  if (!provision) {
    return baseStatus({
      ready: Boolean(cfg.platformKey || (cfg.mgmtKey && canMintForSubject)),
      mechanism: cfg.mgmtKey ? "mgmtApi" : "platformShared",
      status: cfg.platformKey || cfg.mgmtKey ? "deferred_until_auth" : "unconfigured",
      detail: "Provision skipped (status probe only).",
    });
  }

  let lastError: string | undefined;

  for (const mechanism of cfg.order) {
    if (mechanism === "browser" || mechanism === "computerUse" || mechanism === "terminal") {
      // Scaffold only: do not scrape or drive affiliate UIs in this slice.
      lastError = `${mechanism} provisioner is deferred (GitHub #758).`;
      continue;
    }

    if (mechanism === "mgmtApi") {
      if (!cfg.mgmtKey || !canMintForSubject) continue;
      try {
        const minted = await mintOpenRouterKeyViaMgmtApi({
          name: `godmode-trial-${opts.userId ?? opts.visitorKey ?? "visitor"}`.slice(
            0,
            64
          ),
          limitUsd: cfg.budgetUsd,
          expiresAt,
          mgmtKey: cfg.mgmtKey,
          fetchImpl,
        });
        if (opts.tenantDb) {
          await applyTrialToWorkspace({
            tenantDb: opts.tenantDb,
            apiKey: minted.key,
            modelId: cfg.modelId,
            llm: opts.llm,
          });
        }
        upsertGrant(db, {
          subjectKey: subject,
          userId: opts.userId,
          visitorKey: opts.visitorKey,
          mechanism: "mgmtApi",
          modelId: cfg.modelId,
          expiresAt,
          providerKeyHash: minted.hash ?? hashTrialSecret(minted.key),
          providerKeyId: minted.id ?? null,
        });
        return baseStatus({
          ready: true,
          mechanism: "mgmtApi",
          status: "active",
          expiresAt,
          detail: "Minted OpenRouter trial key via Management API.",
        });
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        continue;
      }
    }

    if (mechanism === "platformShared") {
      if (!cfg.platformKey) continue;
      if (opts.tenantDb) {
        await applyTrialToWorkspace({
          tenantDb: opts.tenantDb,
          apiKey: cfg.platformKey,
          modelId: cfg.modelId,
          llm: opts.llm,
        });
      }
      upsertGrant(db, {
        subjectKey: subject,
        userId: opts.userId,
        visitorKey: opts.visitorKey,
        mechanism: "platformShared",
        modelId: cfg.modelId,
        expiresAt,
        providerKeyHash: hashTrialSecret(cfg.platformKey),
      });
      return baseStatus({
        ready: true,
        mechanism: "platformShared",
        status: "active",
        expiresAt,
        detail:
          "Attached platform shared OpenRouter trial key to workspace Vault.",
      });
    }
  }

  return baseStatus({
    ready: false,
    mechanism: "none",
    status: "failed",
    detail:
      lastError ||
      "No trial provision mechanism succeeded. Soft-fail to Vault Connect / FirstRunWizard.",
  });
}

/** Read-only status for UI (no side effects beyond schema ensure). */
export function getTrialInferenceStatus(
  opts: EnsureTrialInferenceOpts = {}
): TrialInferenceStatus {
  const cfg = trialInferenceConfig();
  const db = opts.db ?? getCloudDb();
  const subject = subjectKeyFor({
    userId: opts.userId,
    visitorKey: opts.visitorKey,
    clientIp: opts.clientIp,
  });
  const existing = readActiveGrant(db, subject);
  if (existing) {
    return baseStatus({
      ready: true,
      mechanism: existing.mechanism,
      modelId: existing.model_id,
      status: "active",
      expiresAt: existing.expires_at,
    });
  }
  if (!cfg.mgmtKey && !cfg.platformKey) {
    return baseStatus({
      ready: false,
      mechanism: "none",
      status: "unconfigured",
      detail:
        "Trial inference is not configured. Greeting still displays; chat needs Vault Connect or trial env.",
    });
  }
  if (!opts.userId) {
    return baseStatus({
      ready: Boolean(cfg.platformKey),
      mechanism: cfg.platformKey ? "platformShared" : "mgmtApi",
      status: "deferred_until_auth",
      detail: cfg.platformKey
        ? "Platform trial key present; full attach after sign-in."
        : "Sign in to mint a per-user trial key.",
    });
  }
  return baseStatus({
    ready: false,
    mechanism: cfg.mgmtKey ? "mgmtApi" : "platformShared",
    status: "unconfigured",
    detail: "Call POST /api/trial-inference/ensure to provision.",
  });
}
