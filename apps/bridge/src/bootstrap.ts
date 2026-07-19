import cors from "cors";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import { WebSocketServer } from "ws";
import { EventEmitter } from "node:events";
import "dotenv/config";
import { config } from "./config.js";
import { initCoreDb, listAllTenantIds } from "./core-db.js";
import { getTenantDb, pinTenantDb, closeAllTenantDbs } from "./tenant-registry.js";
import { ensurePlatformBootstrap, ensureInitialAdmins, repairNonOperatorTenantStructure, removeLegacyLifeDepartmentFromPersonalTenants } from "./services/tenant-bootstrap.js";
import { tenantDbMiddleware, attachAuthContext, requireAuth } from "./services/auth/middleware.js";
import { requireTrustedOrigin } from "./services/auth/rate-limit.js";
import { structuredRequestLog } from "./services/request-log.js";
import { createAuthRouter } from "./routes/auth.js";
import { createUpdateRouter } from "./routes/update.js";
import { createMarketplaceRouter } from "./routes/marketplace.js";
import { createMarketplaceCatalogRouter } from "./routes/marketplace-catalog.js";
import {
  createMarketplaceCommerceRouter,
  marketplacePayPalWebhookHandler,
  marketplaceStripeWebhookHandler,
} from "./routes/marketplace-commerce.js";
import { createNetworkRouter } from "./routes/network.js";
import { createOnboardingRouter } from "./routes/onboarding.js";
import { createSharesRouter } from "./routes/shares.js";
import { shareChatSession } from "./services/share-service.js";
import { createDmRouter } from "./routes/dm.js";
import { createUserProductivityRouter } from "./routes/user-productivity.js";
import { createConnectionsRouter } from "./routes/connections.js";
import { legacyEndpointTelemetry } from "./services/legacy-endpoint-telemetry.js";
import {
  assertRuntimeAdapterServicesConfigured,
  configureRuntimeAdapterServices,
} from "./kernel/adapters/runtime.js";
import { createFederationRouter } from "./routes/federation.js";
import { createInferenceRouter } from "./routes/inference.js";
import { createNotificationsRouter } from "./routes/notifications.js";
import { createHooksRouter, createEventsRouter } from "./routes/hooks.js";
import { createSupportRouter } from "./routes/support.js";
import { createWikiRouter } from "./routes/wiki.js";
import { createBankRouter } from "./routes/bank.js";
import { createIntegrationsRouter } from "./routes/integrations.js";
import { createAdminBillingRouter } from "./routes/admin-billing.js";
import { createAdminSaasRouter } from "./routes/admin-saas.js";
import { createSaasRouter, saasStripeWebhookHandler } from "./routes/saas.js";
import { createAdminUsersRouter } from "./routes/admin-users.js";
import { createAdminMarketplaceRouter, createAdminObservabilityRouter } from "./routes/admin-marketplace.js";
import { createAdminWorkspaceTemplateRouter } from "./routes/admin-workspace-template.js";
import { setDispatcherDeps } from "./services/hook-dispatcher.js";
import { startScheduler, stopScheduler } from "./services/scheduler.js";
import { ensureLocalConnection } from "./services/bridge-connections.js";
import type { AppDatabase } from "./db.js";
import { createAiRouter } from "./routes/ai.js";
import {
  createFinancialRouter,
  createFinancialServices,
} from "./routes/financial.js";
import { LlmManager } from "./services/llm-manager.js";
import { EmbeddingManager } from "./services/embeddings/embedding-manager.js";
import { AiQueueWorker } from "./services/ai-queue-worker.js";
import { AiScheduler, registerAiScheduler } from "./services/ai-scheduler.js";
import { AiTrainingManager } from "./services/ai-training-manager.js";
import { ReflectionService } from "./services/reflection-service.js";
import { MemoryMaintenanceService } from "./services/memory-maintenance.js";
import { setWikiEmbedder } from "./services/wiki-service.js";
import { syncAdaptersFromDisk } from "./services/ai-adapters.js";
import { attachWebSocket } from "./ws.js";
import { EngineRegistry } from "./services/engines/registry.js";
import { EngineReconciler } from "./services/engines/reconciler.js";
import { startDbMaintenance } from "./services/db-maintenance.js";
import { startRetentionScheduler } from "./services/retention.js";
import { startMarketplaceBillingScheduler } from "./services/marketplace-billing.js";
import { refreshPeerHealth } from "./services/federation-peers.js";
import { startTenantEventsRelay } from "./services/events-relay.js";
import {
  initTimeseriesStore,
  backfillSqliteTimeseries,
  getTimeseriesStore,
  rollupTicksTo1m,
} from "./services/timeseries-store.js";
import { backfillMemoryFts } from "./services/vector-rag.js";
import { createWorkerPool } from "./services/worker-pool.js";
import { initPluginHost } from "./plugins/plugin-host-bridge.js";
import { pluginRuntime } from "./plugins/runtime.js";
import { getPluginHost } from "@godmode/plugin-host";
import { createCoreApiRouter } from "./routes/api-core.js";
import {
  createKernelRouter,
  createSystemOperationContext,
  executeCollectionAction,
  assertCoreObjectTypeBootstrapComplete,
  materializeAllNativeTypes,
  OperationRunWorker,
  processClaimedOperationRun,
  recoverInterruptedOperationRuns,
  registerCoreObjectTypes,
  setKernelEventBus,
} from "./kernel/index.js";
import { createPluginsRouter, createPluginsManifestHandler } from "./routes/plugins.js";
import {
  reconcileInstalledVersion,
  ReleasePoller,
} from "./services/release-flow.js";

export async function startBridge(): Promise<void> {
const coreDb = initCoreDb();
reconcileInstalledVersion(coreDb);
const { operatorTenantId } = ensurePlatformBootstrap();
ensureInitialAdmins(coreDb);
repairNonOperatorTenantStructure(coreDb);
removeLegacyLifeDepartmentFromPersonalTenants(coreDb);
const db: AppDatabase = getTenantDb(operatorTenantId);
pinTenantDb(operatorTenantId);
const tenantDatabases = (): Array<{ tenantId: string; db: AppDatabase }> => {
  return listAllTenantIds(coreDb).map((tenantId) => ({
    tenantId,
    get db() {
      return getTenantDb(tenantId);
    },
  }));
};
const kernelDatabases = (): Array<{ tenantId: string; db: AppDatabase }> => [
  { tenantId: "core", db: coreDb },
  ...tenantDatabases(),
];
registerCoreObjectTypes();
materializeAllNativeTypes(db, createSystemOperationContext());
for (const tenant of kernelDatabases()) {
  try {
    recoverInterruptedOperationRuns(tenant.db);
  } catch (error) {
    console.warn(
      `[kernel] recovery failed for tenant ${tenant.tenantId}:`,
      error instanceof Error ? error.message : error
    );
  }
}

initPluginHost();
const lifecycleContext = () =>
  createSystemOperationContext({ tenantId: operatorTenantId });
const pluginLoad = (await executeCollectionAction(
  db,
  "CatalogInstall",
  "load_runtime",
  {},
  lifecycleContext()
)) as { loaded: string[]; errors: Array<{ path: string; error: string }> };
if (pluginLoad.loaded.length === 0) {
  console.log("[plugins] none loaded — personal OS only (set GODMODE_PLUGIN_PATH or install from Marketplace)");
} else {
  console.log(`[plugins] active: ${pluginLoad.loaded.join(", ")}`);
}
for (const err of pluginLoad.errors) {
  console.warn(`[plugins] ${err.path}: ${err.error}`);
}

const bus = new EventEmitter();
setKernelEventBus(bus);
pluginRuntime.configure({ operatorTenantId, bus });
await executeCollectionAction(
  db,
  "CatalogInstall",
  "reconcile_runtime",
  { operator_tenant_id: operatorTenantId },
  lifecycleContext()
);

const hasSierra = pluginRuntime.hasPlugin("sierra-chart");

await pluginRuntime.emitHook("boot", {
  operatorTenantId,
  bus,
  operatorDb: db,
  host: getPluginHost(),
});

if (hasSierra) {
  try {
    const operatorOwner = coreDb
      .prepare("SELECT owner_user_id FROM tenants WHERE id = ?")
      .get(operatorTenantId) as { owner_user_id: string } | undefined;
    if (operatorOwner) {
      ensureLocalConnection(coreDb, {
        ownerTenantId: operatorTenantId,
        ownerUserId: operatorOwner.owner_user_id,
      });
    }
  } catch (err) {
    console.warn(
      "[bootstrap] could not register local connection:",
      err instanceof Error ? err.message : err
    );
  }
} else {
  console.log("[plugins] sierra-chart not loaded ? SC/trading IPC disabled");
}

startDbMaintenance(db);
startRetentionScheduler(db);
if (config.isHub) {
  startMarketplaceBillingScheduler();
}
const stopEventsRelay = startTenantEventsRelay(kernelDatabases, bus);
const workerPool = createWorkerPool();

void initTimeseriesStore().then(async (ts) => {
  const counts = await backfillSqliteTimeseries(db, ts);
  if (counts.ticks + counts.bars + counts.pmPrice > 0) {
    console.log(
      `[timeseries] backfill: ticks=${counts.ticks} bars=${counts.bars} pm_price=${counts.pmPrice}`
    );
  }
  try {
    backfillMemoryFts(db);
  } catch {
    /* optional */
  }
  setInterval(() => void rollupTicksTo1m(ts), 6 * 60 * 60 * 1000).unref?.();
}).catch((err) => {
  console.warn("[timeseries] startup failed:", err instanceof Error ? err.message : err);
});

const llmManager = new LlmManager(db);

// Embedding engine: a single CPU-pinned llama-server (embedder) powering
// semantic (RAG) memory retrieval. Feature-flagged and fully optional ? when
// disabled this is inert and chat/RAG fall back to recency. Started after the
// listen() callback below.
const embeddingManager = new EmbeddingManager(db);

// Intelligence: native-tool agent loop runtime ? register any adapters that already
// exist on disk, then stand up the serial queue worker and the event/cron
// scheduler. The scheduler enqueues onto the worker so all automated runs are
// serialized and observable.
syncAdaptersFromDisk(db);
const aiTraining = new AiTrainingManager(db);
const aiQueueWorker = new AiQueueWorker(db, llmManager, {
  bridgePort: config.port,
  bus,
  embeddings: embeddingManager,
});
const operationRunWorker = new OperationRunWorker(
  kernelDatabases,
  processClaimedOperationRun
);
const releasePoller = new ReleasePoller(coreDb);
if (hasSierra) {
  getPluginHost().registerAutonomousRunnerKick?.((reason) => {
    if (aiQueueWorker.hasPendingOrRunningWorkflow("autonomous-task-runner")) return;
    aiQueueWorker.enqueue({
      workflowId: "autonomous-task-runner",
      context: { autonomousTick: true, autoChainTick: 0, reason: reason ?? "backtest-terminal" },
      priority: 1,
    });
  });
}
const aiScheduler = new AiScheduler(db, bus, aiQueueWorker);
registerAiScheduler(aiScheduler);
const reflectionService = new ReflectionService(db, bus, llmManager, aiQueueWorker);
const memoryMaintenance = new MemoryMaintenanceService(db, bus, aiQueueWorker);
configureRuntimeAdapterServices({
  llm: llmManager,
  queue: aiQueueWorker,
  training: aiTraining,
  embeddings: embeddingManager,
  memoryMaintenance,
  shareChat(input) {
    return shareChatSession(coreDb, {
      db: input.db,
      chatId: input.chatId,
      agentId: input.agentId,
      tenantId: input.context.tenantId,
      userId: input.context.userId,
    });
  },
  async syncIntegration() {
    return {
      ok: true,
      queued: true,
      message:
        "Integration sync queued through the configured provider scheduler",
    };
  },
});
assertRuntimeAdapterServicesConfigured();
assertCoreObjectTypeBootstrapComplete();

// Self-discovering engines: provision per-department subagents, rules, skills,
// tools, context, and seed memory. Reconcile at boot (safety net) and on the
// structure bus. Constructed after the LLM + queue so engines can use them.
const engineRegistry = new EngineRegistry(db, {
  llm: llmManager,
  queue: aiQueueWorker,
});
engineRegistry.reconcileAll();
new EngineReconciler(bus, engineRegistry);


const app = express();
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (config.web.allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      if (config.corsPermissive && !config.isProduction) {
        callback(null, true);
        return;
      }
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);
// Stripe webhooks need the raw body — mount before express.json().
if (config.isSaas) {
  app.post(
    "/api/saas/stripe/webhook",
    express.raw({ type: "application/json" }),
    saasStripeWebhookHandler
  );
  app.post(
    "/api/marketplace/commerce/stripe/webhook",
    express.raw({ type: "application/json" }),
    marketplaceStripeWebhookHandler
  );
}
app.use(express.json({ limit: "25mb" }));
app.use(legacyEndpointTelemetry(coreDb));
app.use(structuredRequestLog);
app.use(requireTrustedOrigin);

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    deploymentMode: config.deploymentMode,
    installationSurface: config.installationSurface,
    hub: config.isHub,
    client: config.isClient,
    saas: config.isSaas,
  });
});
app.use("/api", attachAuthContext, (req, res, next) => {
  if (!config.isSaas || !req.user || req.user.emailVerified) {
    next();
    return;
  }
  const raw = (req.originalUrl || req.url || "").split("?")[0] ?? "";
  const p = raw.replace(/^\/api/, "") || req.path;
  if (
    p.startsWith("/auth") ||
    p.startsWith("/saas") ||
    p.includes("webhook") ||
    p === "/health" ||
    p.startsWith("/update")
  ) {
    next();
    return;
  }
  res.status(403).json({
    error: "Email verification required",
    code: "EMAIL_NOT_VERIFIED",
  });
});
app.use("/api/update", createUpdateRouter(coreDb));
app.use("/api/auth", createAuthRouter());
if (config.isSaas) {
  app.use("/api/saas", createSaasRouter());
}
app.use("/api/marketplace/commerce", createMarketplaceCommerceRouter());
if (config.isSaas) {
  app.post(
    "/api/marketplace/commerce/paypal/webhook",
    marketplacePayPalWebhookHandler
  );
}
app.use("/api/marketplace", createMarketplaceRouter());
app.use("/api/marketplace/catalog", createMarketplaceCatalogRouter());
app.use("/api/network", createNetworkRouter());
app.use("/api/onboarding", createOnboardingRouter(llmManager));
app.use("/api/shares", createSharesRouter());
app.use("/api/dm", createDmRouter({ llm: llmManager, bridgePort: config.port }));
app.use("/api/notifications", createNotificationsRouter());
app.use("/api/hooks", createHooksRouter());
app.use("/api/events", createEventsRouter());
app.use("/api/support", createSupportRouter());
app.use("/api/wiki", createWikiRouter(embeddingManager));
app.use("/api/bank", createBankRouter());
if (!config.isHub) {
  app.use("/api/integrations", createIntegrationsRouter());
}
if (config.isHub) {
  app.use("/api/admin/billing", createAdminBillingRouter());
}
if (config.isSaas) {
  app.use("/api/admin/saas", createAdminSaasRouter());
}
app.use("/api/admin", createAdminUsersRouter());
app.use("/api/admin/marketplace", createAdminMarketplaceRouter());
app.use("/api/admin/observability", createAdminObservabilityRouter());
app.use("/api/admin/workspace-template", createAdminWorkspaceTemplateRouter());
app.use("/api/inference", createInferenceRouter(llmManager));
app.use("/api/connections", createConnectionsRouter());
app.use("/api/user", createUserProductivityRouter());
app.use("/api/federation", createFederationRouter({
  pingSc: () => getPluginHost().pingScHealth?.() ?? Promise.resolve({ ok: false, detail: "sierra plugin not loaded" }),
}));
app.get("/api/plugins/manifest", tenantDbMiddleware, attachAuthContext, requireAuth, createPluginsManifestHandler(coreDb));
app.use("/api", tenantDbMiddleware, createCoreApiRouter(db, { bus }));
app.use("/api", tenantDbMiddleware, createKernelRouter(db, { bus }));
app.use("/api/plugins", tenantDbMiddleware, attachAuthContext, requireAuth, createPluginsRouter(coreDb));
pluginRuntime.mountOn(app);

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
const broadcast = attachWebSocket(wss, bus);

await pluginRuntime.emitHook("server:beforeListen", {
  operatorTenantId,
  bus,
  operatorDb: db,
  host: getPluginHost(),
  app,
  broadcast,
});

const financialRouter = createFinancialRouter();
app.use("/api/financial", tenantDbMiddleware, financialRouter);
app.use(
  "/api/ai",
  tenantDbMiddleware,
  createAiRouter(db, llmManager, {
    queue: aiQueueWorker,
    training: aiTraining,
    scheduler: aiScheduler,
    bridgePort: config.port,
    embeddings: embeddingManager,
    reflection: reflectionService,
    memoryMaintenance,
    bus,
  })
);

server.listen(config.port, config.host, () => {
  console.log(`Bridge listening on http://${config.host}:${config.port} [${config.deploymentMode}]`);
  if (config.isHub) {
    console.log("[hub] Multi-tenant SaaS mode ? anonymous auth disabled by default");
  }
  if (config.isClient) {
    console.log(`[client] Marketplace proxy -> ${config.cloudHubUrl || "(CLOUD_HUB_URL not set)"}`);
  }
  console.log(`IPC directory: ${config.ipcDir}`);
  console.log(`Database (operator tenant): ${config.tenantsDir}/${operatorTenantId}.sqlite`);
  console.log(`Core database: ${config.coreDbPath}`);
  void llmManager.maybeAutoStart();
  void (async () => {
    if (
      config.embeddings.external ||
      fs.existsSync(config.embeddings.embedderModelPath)
    ) {
      try {
        const status = await embeddingManager.setEnabled(true);
        console.log(`[embeddings] boot enabled=${status.enabled} external=${config.embeddings.external}`);
        if (embeddingManager.isEmbedderReady()) {
          setWikiEmbedder(embeddingManager.getEmbeddingClient());
        }
      } catch (err) {
        console.warn(
          "[embeddings] boot enable failed:",
          err instanceof Error ? err.message : String(err)
        );
      }
    } else {
      void embeddingManager.maybeAutoStart();
    }
    try {
      const { rebuildAllAgentCapabilityIndexes } = await import(
        "./services/capability-index.js"
      );
      const n = await rebuildAllAgentCapabilityIndexes(
        db,
        embeddingManager.getEmbeddingClient()
      );
      console.log(`[capability-index] boot rebuild: ${n} rows`);
    } catch (err) {
      console.warn(
        "[capability-index] boot rebuild failed:",
        err instanceof Error ? err.message : String(err)
      );
    }
  })();
  aiQueueWorker.start();
  operationRunWorker.start();
  releasePoller.start();
  aiScheduler.start();
  reflectionService.start();
  memoryMaintenance.start();
  if (embeddingManager.isEmbedderReady()) {
    setWikiEmbedder(embeddingManager.getEmbeddingClient());
  }
  // Keep wiki index embedder in sync when the engine comes up after boot.
  const wikiEmbedSync = setInterval(() => {
    if (embeddingManager.isEmbedderReady()) {
      setWikiEmbedder(embeddingManager.getEmbeddingClient());
    }
  }, 15_000);
  void wikiEmbedSync;
  setDispatcherDeps({ llm: llmManager, bridgePort: config.port, queue: aiQueueWorker });
  startScheduler();
  setInterval(() => {
    try {
      const rows = coreDb
        .prepare(`SELECT DISTINCT local_user_id FROM peer_connections`)
        .all() as Array<{ local_user_id: string }>;
      for (const row of rows) {
        void refreshPeerHealth(coreDb, row.local_user_id);
      }
    } catch {
      /* peer table may not exist yet on very old cores */
    }
  }, 5 * 60 * 1000).unref?.();
  void pluginRuntime.emitHook("server:afterListen", {
    operatorTenantId,
    bus,
    operatorDb: db,
    host: getPluginHost(),
    app,
    broadcast,
  });
});

function gracefulShutdown() {
  stopEventsRelay();
  operationRunWorker.stop();
  releasePoller.stop();
  workerPool.shutdown();
  stopScheduler();
  aiScheduler.stop();
  reflectionService.stop();
  aiQueueWorker.stop();
  llmManager.shutdown();
  embeddingManager.shutdown();
  void pluginRuntime.emitHook("server:shutdown", {
    operatorTenantId,
    bus,
    host: getPluginHost(),
  });
  closeAllTenantDbs();
  try {
    coreDb.close();
  } catch {
    /* ignore */
  }
  server.close();
}

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);
}
