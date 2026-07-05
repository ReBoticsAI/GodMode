import { v4 as uuidv4 } from "uuid";
import type { CoreDatabase } from "../core-db.js";
import { getTenantDb } from "../tenant-registry.js";
import { adjustCredits, CreditsError } from "./credits.js";
import type { LlmManager } from "./llm-manager.js";
import { runAgentChat, type AgentSampling, type AgentMessage } from "./ai-agent.js";
import { hasModelShareAccess } from "./share-service.js";

interface QueuedRequest {
  resolve: (value: string) => void;
  reject: (err: Error) => void;
  run: () => Promise<string>;
  priority: number;
}

const queues = new Map<string, QueuedRequest[]>();
const activeByBuyer = new Map<string, number>();

function enqueue(endpointId: string, buyerUserId: string, req: QueuedRequest, capacity: number): void {
  const key = endpointId;
  const activeKey = `${endpointId}:${buyerUserId}`;
  const active = activeByBuyer.get(activeKey) ?? 0;
  if (active < capacity) {
    activeByBuyer.set(activeKey, active + 1);
    void req
      .run()
      .then(req.resolve)
      .catch(req.reject)
      .finally(() => {
        activeByBuyer.set(activeKey, Math.max(0, (activeByBuyer.get(activeKey) ?? 1) - 1));
        drainQueue(key);
      });
    return;
  }
  const q = queues.get(key) ?? [];
  q.push(req);
  q.sort((a, b) => b.priority - a.priority);
  queues.set(key, q);
}

function drainQueue(endpointId: string): void {
  const q = queues.get(endpointId);
  if (!q?.length) return;
  const next = q.shift()!;
  queues.set(endpointId, q);
  void next.run().then(next.resolve).catch(next.reject);
}

export function listInferenceEndpoints(
  core: CoreDatabase,
  ownerUserId: string
): Array<Record<string, unknown>> {
  return core
    .prepare(
      `SELECT * FROM inference_endpoints
       WHERE owner_user_id=? AND status='active'
       ORDER BY created_at DESC`
    )
    .all(ownerUserId) as Array<Record<string, unknown>>;
}

export function createInferenceEndpoint(
  core: CoreDatabase,
  opts: {
    ownerTenantId: string;
    ownerUserId: string;
    name: string;
    baseModelPath: string;
    adapterIds?: string[];
    meterUnit?: string;
    meterRate?: number;
    capacityHint?: number;
  }
): string {
  const id = uuidv4();
  core.prepare(
    `INSERT INTO inference_endpoints
       (id, owner_tenant_id, owner_user_id, name, base_model_path,
        adapter_ids_json, meter_unit, meter_rate, capacity_hint, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
  ).run(
    id,
    opts.ownerTenantId,
    opts.ownerUserId,
    opts.name,
    opts.baseModelPath,
    JSON.stringify(opts.adapterIds ?? []),
    opts.meterUnit ?? "request",
    opts.meterRate ?? 1,
    opts.capacityHint ?? 1
  );
  return id;
}

/**
 * Find an existing active endpoint owned by `ownerUserId` for `baseModelPath`,
 * so free model-sharing can de-dupe instead of minting a new endpoint per share.
 */
export function findActiveEndpointByModelPath(
  core: CoreDatabase,
  ownerUserId: string,
  baseModelPath: string
): Record<string, unknown> | null {
  return (
    (core
      .prepare(
        `SELECT * FROM inference_endpoints
         WHERE owner_user_id=? AND base_model_path=? AND status='active'
         ORDER BY created_at ASC LIMIT 1`
      )
      .get(ownerUserId, baseModelPath) as Record<string, unknown> | undefined) ?? null
  );
}

export function getInferenceEndpoint(
  core: CoreDatabase,
  endpointId: string
): Record<string, unknown> | null {
  return (
    (core
      .prepare(`SELECT * FROM inference_endpoints WHERE id=? AND status='active'`)
      .get(endpointId) as Record<string, unknown> | undefined) ?? null
  );
}

function findActiveEntitlement(
  core: CoreDatabase,
  buyerUserId: string,
  buyerTenantId: string,
  endpointId: string
): Record<string, unknown> | null {
  const listing = core
    .prepare(
      `SELECT l.* FROM marketplace_listings l
       WHERE l.inference_endpoint_id=? AND l.status='active'`
    )
    .get(endpointId) as Record<string, unknown> | undefined;
  if (!listing) return null;
  return (
    (core
      .prepare(
        `SELECT * FROM marketplace_entitlements
         WHERE listing_id=? AND buyer_user_id=? AND buyer_tenant_id=? AND status='active'`
      )
      .get(listing.id, buyerUserId, buyerTenantId) as Record<string, unknown> | undefined) ??
    null
  );
}

function meterInferenceUsage(
  core: CoreDatabase,
  opts: {
    endpoint: Record<string, unknown>;
    buyerUserId: string;
    tokensIn: number;
    tokensOut: number;
    listing?: Record<string, unknown> | null;
  }
): number {
  const meterUnit = String(opts.endpoint.meter_unit ?? "request");
  const meterRate = Number(opts.endpoint.meter_rate ?? 1);
  let credits = meterRate;
  if (meterUnit === "token") {
    credits = Math.max(1, Math.ceil((opts.tokensIn + opts.tokensOut) / 1000) * meterRate);
  }
  const sellerId = String(opts.endpoint.owner_user_id);
  adjustCredits(core, {
    userId: opts.buyerUserId,
    delta: -credits,
    reason: "inference_usage",
    refType: "endpoint",
    refId: String(opts.endpoint.id),
  });
  if (sellerId !== opts.buyerUserId) {
    adjustCredits(core, {
      userId: sellerId,
      delta: credits,
      reason: "inference_earnings",
      refType: "endpoint",
      refId: String(opts.endpoint.id),
    });
  }
  core.prepare(
    `INSERT INTO inference_usage
       (id, endpoint_id, buyer_user_id, tokens_in, tokens_out, requests, credits_charged)
     VALUES (?, ?, ?, ?, ?, 1, ?)`
  ).run(uuidv4(), opts.endpoint.id, opts.buyerUserId, opts.tokensIn, opts.tokensOut, credits);
  return credits;
}

export async function runRemoteInference(
  core: CoreDatabase,
  llm: LlmManager,
  opts: {
    endpointId: string;
    buyerUserId: string;
    buyerTenantId: string;
    messages: AgentMessage[];
    sampling: AgentSampling;
    onToken?: (chunk: string) => void;
    priority?: number;
  }
): Promise<string> {
  const endpoint = getInferenceEndpoint(core, opts.endpointId);
  if (!endpoint) throw new Error("Inference endpoint not found");

  const ownerTenantId = String(endpoint.owner_tenant_id);
  const ownerDb = getTenantDb(ownerTenantId);
  const entitlement = findActiveEntitlement(
    core,
    opts.buyerUserId,
    opts.buyerTenantId,
    opts.endpointId
  );
  const listing = core
    .prepare(`SELECT * FROM marketplace_listings WHERE inference_endpoint_id=?`)
    .get(opts.endpointId) as Record<string, unknown> | undefined;
  const pricingModel = String(listing?.pricing_model ?? "metered");
  // Free friend-to-friend sharing: a `model` share_grant for this endpoint
  // grants the buyer access with NO credits metered, regardless of any
  // marketplace listing. This bypasses the entitlement gate entirely.
  const freeViaShare = hasModelShareAccess(core, {
    userId: opts.buyerUserId,
    tenantId: opts.buyerTenantId,
    endpointId: opts.endpointId,
  });
  if (!freeViaShare && (pricingModel === "metered" || pricingModel === "subscription")) {
    if (!entitlement && String(endpoint.owner_user_id) !== opts.buyerUserId) {
      throw new CreditsError(403, "No active entitlement for this endpoint");
    }
  }

  const capacity = Number(endpoint.capacity_hint ?? 1);
  const adapterIds = JSON.parse(String(endpoint.adapter_ids_json ?? "[]")) as string[];

  return new Promise((resolve, reject) => {
    enqueue(
      opts.endpointId,
      opts.buyerUserId,
      {
        priority: opts.priority ?? 1,
        resolve,
        reject,
        run: async () => {
          const baseModelPath = String(endpoint.base_model_path);
          if (!llm.isReady()) {
            await llm.start(baseModelPath);
          } else {
            const status = llm.getStatus();
            if (status.modelPath !== baseModelPath) {
              await llm.restart(baseModelPath);
            }
          }

          const lora: Array<{ id: number; scale: number }> = [];
          if (adapterIds.length) {
            const rows = ownerDb
              .prepare(`SELECT id, path, default_scale FROM ai_adapters WHERE enabled=1`)
              .all() as Array<{ id: string; path: string; default_scale: number }>;
            const pathToIndex = new Map<string, number>();
            llm.getEnabledAdapterPaths().forEach((p, i) => pathToIndex.set(p, i));
            for (const aid of adapterIds) {
              const row = rows.find((r) => r.id === aid);
              if (!row) continue;
              const idx = pathToIndex.get(row.path);
              if (idx != null) lora.push({ id: idx, scale: row.default_scale });
            }
          }

          const text = await runAgentChat({
            baseUrl: llm.getServerBaseUrl(),
            messages: opts.messages,
            sampling: opts.sampling,
            nativeTools: false,
            lora: lora.length ? lora : undefined,
            maxIterations: 1,
            toolCtx: {
              db: ownerDb,
              activeAgentId: "intelligence",
              userId: opts.buyerUserId,
            },
            onToken: opts.onToken,
          });

          const tokensIn = opts.messages.reduce((n, m) => n + m.content.length, 0) / 4;
          const tokensOut = text.length / 4;
          if (!freeViaShare && pricingModel === "metered") {
            meterInferenceUsage(core, {
              endpoint,
              buyerUserId: opts.buyerUserId,
              tokensIn: Math.ceil(tokensIn),
              tokensOut: Math.ceil(tokensOut),
              listing,
            });
          }
          return text;
        },
      },
      capacity
    );
  });
}
