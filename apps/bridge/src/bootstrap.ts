import cors from "cors";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import { WebSocketServer } from "ws";
import { EventEmitter } from "node:events";
import "dotenv/config";
import { config } from "./config.js";
import { initCoreDb } from "./core-db.js";
import { getTenantDb, pinTenantDb, closeAllTenantDbs } from "./tenant-registry.js";
import { ensurePlatformBootstrap, ensureInitialAdmins, repairNonOperatorTenantStructure, removeLegacyLifeDepartmentFromPersonalTenants } from "./services/tenant-bootstrap.js";
import { tenantDbMiddleware, attachAuthContext, requireAuth } from "./services/auth/middleware.js";
import { createAuthRouter } from "./routes/auth.js";
import { createMarketplaceRouter } from "./routes/marketplace.js";
import { createMarketplaceCatalogRouter } from "./routes/marketplace-catalog.js";
import { createNetworkRouter } from "./routes/network.js";
import { createOnboardingRouter } from "./routes/onboarding.js";
import { createSharesRouter } from "./routes/shares.js";
import { createDmRouter } from "./routes/dm.js";
import { createUserProductivityRouter } from "./routes/user-productivity.js";
import { createConnectionsRouter } from "./routes/connections.js";
import { createFederationRouter } from "./routes/federation.js";
import { createInferenceRouter } from "./routes/inference.js";
import { createNotificationsRouter } from "./routes/notifications.js";
import { createHooksRouter, createEventsRouter } from "./routes/hooks.js";
import { createSupportRouter } from "./routes/support.js";
import { createWikiRouter } from "./routes/wiki.js";
import { createBankRouter } from "./routes/bank.js";
import { createIntegrationsRouter } from "./routes/integrations.js";
import { createAdminBillingRouter } from "./routes/admin-billing.js";
import { createAdminUsersRouter } from "./routes/admin-users.js";
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
import { syncAdaptersFromDisk } from "./services/ai-adapters.js";
import { attachWebSocket } from "./ws.js";
import { EngineRegistry } from "./services/engines/registry.js";
import { EngineReconciler } from "./services/engines/reconciler.js";
import { startDbMaintenance } from "./services/db-maintenance.js";
import { startRetentionScheduler } from "./services/retention.js";
import { startMarketplaceBillingScheduler } from "./services/marketplace-billing.js";
import { refreshPeerHealth } from "./services/federation-peers.js";
import { startEventsRelay } from "./services/events-relay.js";
import {
  initTimeseriesStore,
  backfillSqliteTimeseries,
  getTimeseriesStore,
  rollupTicksTo1m,
} from "./services/timeseries-store.js";
import { backfillMemoryFts } from "./services/vector-rag.js";
import { createWorkerPool } from "./services/worker-pool.js";
import { loadPluginsFromEnv } from "./plugins/loader.js";
import { initPluginHost } from "./plugins/plugin-host-bridge.js";
import { pluginRuntime } from "./plugins/runtime.js";
import { getPluginHost } from "@godmode/plugin-host";
import { createCoreApiRouter } from "./routes/api-core.js";
import { createPluginsRouter, createPluginsManifestHandler } from "./routes/plugins.js";
import {
  ensureOperatorPluginsInstalled,
  ensureTenantPluginsTable,
  syncInstalledPluginKnowledge,
} from "./plugins/plugin-install.js";

export async function startBridge(): Promise<void> {
const coreDb = initCoreDb();
const { operatorTenantId } = ensurePlatformBootstrap();
ensureInitialAdmins(coreDb);
repairNonOperatorTenantStructure(coreDb);
removeLegacyLifeDepartmentFromPersonalTenants(coreDb);
const db: AppDatabase = getTenantDb(operatorTenantId);
pinTenantDb(operatorTenantId);

initPluginHost();
const pluginLoad = await loadPluginsFromEnv();
if (pluginLoad.loaded.length === 0) {
  console.log("[plugins] none loaded — personal OS only (set GODMODE_PLUGIN_PATH or install from Marketplace)");
} else {
  console.log(`[plugins] active: ${pluginLoad.loaded.join(", ")}`);
}
for (const err of pluginLoad.errors) {
  console.warn(`[plugins] ${err.path}: ${err.error}`);
}

const bus = new EventEmitter();
pluginRuntime.configure({ operatorTenantId, bus });
ensureTenantPluginsTable(coreDb);
await ensureOperatorPluginsInstalled(coreDb, operatorTenantId, db);
syncInstalledPluginKnowledge(coreDb, operatorTenantId);

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
startEventsRelay(db, bus);
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
const aiQueueWorker = new AiQueueWorker(db, llmManager, { bridgePort: config.port, bus });
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
app.use(express.json({ limit: "25mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    deploymentMode: config.deploymentMode,
    hub: config.isHub,
    client: config.isClient,
  });
});
app.use("/api/auth", createAuthRouter());
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
app.use("/api/wiki", createWikiRouter());
app.use("/api/bank", createBankRouter());
if (!config.isHub) {
  app.use("/api/integrations", createIntegrationsRouter());
}
if (config.isHub) {
  app.use("/api/admin/billing", createAdminBillingRouter());
}
app.use("/api/admin", createAdminUsersRouter());
app.use("/api/admin/workspace-template", createAdminWorkspaceTemplateRouter());
app.use("/api/inference", createInferenceRouter(llmManager));
app.use("/api/connections", createConnectionsRouter());
app.use("/api/user", createUserProductivityRouter());
app.use("/api/federation", createFederationRouter({
  pingSc: () => getPluginHost().pingScHealth?.() ?? Promise.resolve({ ok: false, detail: "sierra plugin not loaded" }),
}));
app.get("/api/plugins/manifest", tenantDbMiddleware, attachAuthContext, requireAuth, createPluginsManifestHandler(coreDb));
app.use("/api", tenantDbMiddleware, createCoreApiRouter(db, { bus }));
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
    if (fs.existsSync(config.embeddings.embedderModelPath)) {
      try {
        const status = await embeddingManager.setEnabled(true);
        console.log(`[embeddings] boot enabled=${status.enabled}`);
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
  aiScheduler.start();
  reflectionService.start();
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
