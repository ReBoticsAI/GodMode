import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultPlatformDataDir } from "./services/data-dir-migration.js";

const bridgeDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot =
  process.env.PLATFORM_REPO_ROOT ??
  path.resolve(bridgeDir, "../../..");

const appDataRoot =
  process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");

const appData =
  process.env.PLATFORM_DATA_DIR ?? defaultPlatformDataDir(appDataRoot);

const deploymentModeRaw = (process.env.DEPLOYMENT_MODE ?? "local").toLowerCase();
const deploymentMode =
  deploymentModeRaw === "hub" || deploymentModeRaw === "client"
    ? deploymentModeRaw
    : "local";

const webPublicUrl =
  process.env.WEB_PUBLIC_URL ??
  (deploymentMode === "hub" ? "" : "http://127.0.0.1:5173");

const corsOrigins = (process.env.WEB_ORIGIN ?? (webPublicUrl || "http://127.0.0.1:5173"))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const isHub = deploymentMode === "hub";
const isProduction = deploymentMode === "hub" || deploymentMode === "client";
const installationSurface = (
  process.env.INSTALLATION_SURFACE ?? "developer_source"
).toLowerCase();
/** Official paid multi-tenant hub (ReBotics SaaS). Self-hosted hubs use `private_hub`. */
const isSaas = isHub && installationSurface === "saas";

export const config = {
  /** local = dev workstation; hub = multi-tenant; client = personal Docker instance. */
  deploymentMode: deploymentMode as "local" | "hub" | "client",
  isHub,
  isClient: deploymentMode === "client",
  isProduction,
  installationSurface,
  isSaas,
  saas: {
    /**
     * Allowed Stripe Price IDs for SaaS Checkout.
     * Prefer monthly/yearly env vars; `STRIPE_SAAS_PRICE_ID` remains a single-plan fallback.
     */
    plans: (() => {
      const monthly = (process.env.STRIPE_SAAS_PRICE_MONTHLY ?? "").trim();
      const yearly = (process.env.STRIPE_SAAS_PRICE_YEARLY ?? "").trim();
      const legacy = (process.env.STRIPE_SAAS_PRICE_ID ?? "").trim();
      const plans: Array<{
        id: "monthly" | "yearly" | "default";
        priceId: string;
        label: string;
        amountLabel: string;
        interval: "month" | "year" | "one_time";
      }> = [];
      if (monthly) {
        plans.push({
          id: "monthly",
          priceId: monthly,
          label: "Monthly",
          amountLabel: "$9.99/month",
          interval: "month",
        });
      }
      if (yearly) {
        plans.push({
          id: "yearly",
          priceId: yearly,
          label: "Yearly",
          amountLabel: "$74.99/year",
          interval: "year",
        });
      }
      if (plans.length === 0 && legacy) {
        plans.push({
          id: "default",
          priceId: legacy,
          label: "GodMode Cloud",
          amountLabel: "Paid access",
          interval: "one_time",
        });
      }
      return plans;
    })(),
    /** `payment` (one-time) or `subscription`. Defaults to subscription when plan prices are set. */
    checkoutMode: ((
      process.env.STRIPE_SAAS_CHECKOUT_MODE ??
      ((process.env.STRIPE_SAAS_PRICE_MONTHLY || process.env.STRIPE_SAAS_PRICE_YEARLY)
        ? "subscription"
        : "payment")
    ).toLowerCase() === "subscription"
      ? "subscription"
      : "payment") as "payment" | "subscription",
    webhookSecret: (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim(),
  },
  /** Official cloud hub for marketplace/credits when running in client mode. */
  cloudHubUrl: (process.env.CLOUD_HUB_URL ?? "").replace(/\/$/, ""),
  port: Number(process.env.BRIDGE_PORT ?? 3847),
  host: process.env.BRIDGE_HOST ?? "127.0.0.1",
  web: {
    publicUrl: webPublicUrl || "http://127.0.0.1:5173",
    allowedOrigins: corsOrigins.length > 0 ? corsOrigins : ["http://127.0.0.1:5173"],
  },
  /** When true, allow any Origin in non-production (dev convenience). Default: strict WEB_ORIGIN only. */
  corsPermissive: process.env.CORS_PERMISSIVE === "true",
  /** Optional token for cloning private GitHub plugin repos via Marketplace install. */
  githubToken: process.env.GITHUB_TOKEN ?? "",
  dtc: {
    host: process.env.DTC_HOST ?? "127.0.0.1",
    port: Number(process.env.DTC_PORT ?? 11099),
    enabled: process.env.DTC_ENABLED !== "false",
  },
  dataDir: appData,
  /** Root directory for per-agent sandboxes ({dataDir}/agents/<agentId>). */
  agentsDir: path.join(appData, "agents"),
  dbPath: path.join(appData, "platform.db"),
  /** Shared core DB: users, tenants, marketplace, credits, share grants. */
  coreDbPath: path.join(appData, "core.sqlite"),
  /** Per-tenant workspace SQLite files ({tenantsDir}/<tenantId>.sqlite). */
  tenantsDir: path.join(appData, "tenants"),
  /** Per-tenant Intelligence sandbox workspaces ({tenantWorkspacesDir}/<tenantId>/). */
  tenantWorkspacesDir: path.join(appData, "tenant-workspaces"),
  auth: {
    /** Bridge base URL for session cookies (e.g. http://127.0.0.1:3847). */
    publicUrl: process.env.AUTH_PUBLIC_URL ?? `http://127.0.0.1:${process.env.BRIDGE_PORT ?? 3847}`,
    sessionSecret:
      process.env.AUTH_SESSION_SECRET ?? "dev-change-me-in-production",
    sessionTtlDays: Number(process.env.AUTH_SESSION_TTL_DAYS ?? 30),
    /** When true, unauthenticated API requests use the system-local user (dev tooling only). */
    allowAnonymous: process.env.AUTH_ALLOW_ANONYMOUS === "true",
    /** Open email/password signup (disabled on hub by default). */
    allowSignup:
      process.env.AUTH_ALLOW_SIGNUP != null
        ? process.env.AUTH_ALLOW_SIGNUP === "true"
        : !isHub,
    /** Comma-separated invite codes required for signup when set (hub). */
    inviteCodes: (process.env.AUTH_INVITE_CODES ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    /** Pre-seeded platform admins: "Name:email,Name:email" (emails must match signup/login). */
    initialAdmins: (process.env.INITIAL_ADMINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((entry) => {
        const colon = entry.indexOf(":");
        if (colon <= 0) return null;
        return {
          name: entry.slice(0, colon).trim(),
          email: entry.slice(colon + 1).trim().toLowerCase(),
        };
      })
      .filter((a): a is { name: string; email: string } => Boolean(a?.name && a?.email)),
    /** Optional password for INITIAL_ADMINS seed users (local/client only). Empty = no password seeded. */
    initialAdminPassword: process.env.INITIAL_ADMIN_PASSWORD ?? "",
  },
  email: {
    provider: (process.env.EMAIL_PROVIDER ?? "none").toLowerCase() as
      | "none"
      | "resend"
      | "smtp",
    from: process.env.EMAIL_FROM ?? "GodMode <noreply@localhost>",
    resendApiKey: (process.env.RESEND_API_KEY ?? "").trim(),
    smtp: {
      host: process.env.SMTP_HOST ?? "",
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      user: process.env.SMTP_USER ?? "",
      pass: process.env.SMTP_PASS ?? "",
    },
  },
  oauth: {
    google: {
      clientId: (process.env.OAUTH_GOOGLE_CLIENT_ID ?? "").trim(),
      clientSecret: (process.env.OAUTH_GOOGLE_CLIENT_SECRET ?? "").trim(),
    },
    github: {
      clientId: (process.env.OAUTH_GITHUB_CLIENT_ID ?? "").trim(),
      clientSecret: (process.env.OAUTH_GITHUB_CLIENT_SECRET ?? "").trim(),
    },
  },
  backups: {
    localDir: process.env.BACKUP_LOCAL_DIR ?? "",
    s3: {
      endpoint: (process.env.BACKUP_S3_ENDPOINT ?? "").trim(),
      region: process.env.BACKUP_S3_REGION ?? "auto",
      bucket: (process.env.BACKUP_S3_BUCKET ?? "").trim(),
      accessKeyId: (process.env.BACKUP_S3_ACCESS_KEY_ID ?? "").trim(),
      secretAccessKey: (process.env.BACKUP_S3_SECRET_ACCESS_KEY ?? "").trim(),
      prefix: process.env.BACKUP_S3_PREFIX ?? "godmode/",
    },
  },
  businessWebsiteUrl: (process.env.BUSINESS_WEBSITE_URL ?? "").trim(),
  /** When saas: deny agent codeAccess unless PLATFORM_SAAS_ALLOW_CODE_ACCESS=true */
  saasAllowCodeAccess: process.env.PLATFORM_SAAS_ALLOW_CODE_ACCESS === "true",
  /** When saas: block tenant Local plugin path registration unless true */
  saasAllowLocalPlugins: process.env.PLATFORM_SAAS_ALLOW_LOCAL_PLUGINS === "true",
  federation: {
    /** Shared secret peers present to this Bridge's federation API (empty = derive from share grants only). */
    token: process.env.FEDERATION_TOKEN ?? "",
    /** Publicly reachable base URL of this Bridge for remote peers. */
    publicUrl:
      process.env.FEDERATION_PUBLIC_URL ??
      `http://${process.env.BRIDGE_HOST ?? "127.0.0.1"}:${process.env.BRIDGE_PORT ?? 3847}`,
  },
  ipcDir: path.join(appData, "ipc"),
  ipcResyncDir: path.join(appData, "ipc", "resync"),
  ipcPlaybookCmdDir: path.join(appData, "ipc", "cmd"),
  ipcInbound: path.join(appData, "ipc", "to_sc.txt"),
  ipcOutbound: path.join(appData, "ipc", "from_sc.txt"),
  ipcOutboundMaxBytes: Number(process.env.IPC_OUTBOUND_MAX_BYTES ?? 50 * 1024 * 1024),
  chartPlatformDir: process.env.SIERRA_CHART_DIR ?? "",
  chartPlatformDataDir: process.env.SIERRA_CHART_DATA_DIR ?? "",
  chartPlatformAcsSource: process.env.SIERRA_CHART_ACS_SOURCE ?? "",
  scUdpPort: Number(process.env.SC_UDP_PORT ?? 22903),
  msysBash: process.env.MSYS2_BASH ?? "",
  useStudyReloader: process.env.USE_STUDY_RELOADER !== "false",
  codegenOutputDir:
    process.env.CODEGEN_OUTPUT ?? path.join(repoRoot, "codegen-stubs"),
  repoRoot,
  /**
   * Optional explicit list of chart numbers to use as the backtest pool.
   * Auto-numbering varies by host; users normally configure this from the UI
   * which writes to the sc_charts table; this env list is only the bootstrap
   * fallback when the DB has no chart selections.
   */
  backtestChartList: (process.env.BACKTEST_CHARTS ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0),
  /** Last-resort range fallback (used only if no DB selection and no env list). */
  backtestChartRange: {
    start: Number(process.env.BACKTEST_CHART_START ?? 13),
    end: Number(process.env.BACKTEST_CHART_END ?? 22),
  },
  /** Normalized chartbook key for live Platform.cht command routing. */
  liveChartbookKey: (process.env.LIVE_CHARTBOOK ?? "Platform").replace(
    /[^a-zA-Z0-9_-]/g,
    ""
  ),
  /** Normalized chartbook key for Backtest.cht isolated backtests. */
  backtestChartbookKey: (process.env.BACKTEST_CHARTBOOK ?? "Backtest").replace(
    /[^a-zA-Z0-9_-]/g,
    ""
  ),
  /** Host input index for "Sim Only" on generated studies (plugin-specific). */
  backtestSimOnlyInputIndex: Number(process.env.BACKTEST_SIM_INPUT_INDEX ?? 99),
  ai: {
    llamaServerBin:
      process.env.LLAMA_SERVER_BIN ??
      path.join(os.homedir(), "llama.cpp", "bin", "llama-server.exe"),
    /**
     * When true, Bridge does not spawn llama-server; it attaches to an
     * already-running OpenAI-compatible server at serverHost:serverPort
     * (e.g. host systemd on a Docker hub).
     */
    external: (process.env.LLAMA_EXTERNAL ?? "false") === "true",
    modelDirs: (
      process.env.LLAMA_MODEL_DIRS ??
      [
        path.join(os.homedir(), "llama.cpp", "models"),
        path.join(os.homedir(), "Downloads"),
      ].join(";")
    )
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean),
    serverHost: process.env.LLAMA_SERVER_HOST ?? "127.0.0.1",
    serverPort: Number(process.env.LLAMA_SERVER_PORT ?? 8080),
    // Gemma 4 trains to 131072 and uses sliding-window attention, so the KV
    // cache stays small even at large contexts (~2GB per 128k slot on a 16GB
    // GPU with full offload). --ctx-size is the TOTAL split across --parallel
    // slots, so 262144 over 2 slots gives each concurrent request the full
    // 128k window (~13.4GB used). Lower if you hit VRAM limits with a different
    // model; 3 slots of 128k would OOM on 16GB.
    defaultCtxSize: Number(process.env.LLAMA_CTX_SIZE ?? 262144),
    defaultGpuLayers: Number(process.env.LLAMA_GPU_LAYERS ?? 99),
    flashAttn: process.env.LLAMA_FLASH_ATTN ?? "on",
    // --- Server launch flags (passed to llama-server) ---
    defaultThreads: Number(process.env.LLAMA_THREADS ?? 0), // 0 = let llama decide
    defaultBatchSize: Number(process.env.LLAMA_BATCH_SIZE ?? 2048),
    defaultUbatchSize: Number(process.env.LLAMA_UBATCH_SIZE ?? 512),
    defaultParallel: Number(process.env.LLAMA_PARALLEL ?? 2),
    defaultJinja: (process.env.LLAMA_JINJA ?? "true") !== "false",
    // Free-form extra llama-server flags appended verbatim to the launch argv.
    // Needed for MoE expert CPU offload (e.g. "--n-cpu-moe 8"), tensor
    // overrides ("-ot exps=CPU"), or KV cache quant ("--cache-type-k q8_0").
    // Quoted tokens are preserved so JSON values (e.g. --chat-template-kwargs)
    // survive intact. Empty by default so existing dense models are unchanged.
    defaultExtraArgs: process.env.LLAMA_EXTRA_ARGS ?? "",
    // --- Sampling / generation defaults (per chat request) ---
    defaultTemperature: Number(process.env.LLAMA_TEMPERATURE ?? 1.0),
    defaultTopP: Number(process.env.LLAMA_TOP_P ?? 0.95),
    defaultTopK: Number(process.env.LLAMA_TOP_K ?? 64),
    defaultMinP: Number(process.env.LLAMA_MIN_P ?? 0.05),
    defaultRepeatPenalty: Number(process.env.LLAMA_REPEAT_PENALTY ?? 1.1),
    defaultPresencePenalty: Number(process.env.LLAMA_PRESENCE_PENALTY ?? 0),
    defaultFrequencyPenalty: Number(process.env.LLAMA_FREQUENCY_PENALTY ?? 0),
    defaultMaxTokens: Number(process.env.LLAMA_MAX_TOKENS ?? 2048),
    defaultSeed: Number(process.env.LLAMA_SEED ?? -1), // -1 = random
    // Base system prompt. Platform context (current page + @mentions) is
    // appended at request time; this is just the persona/instructions block.
    defaultSystemPrompt:
      process.env.LLAMA_SYSTEM_PROMPT ??
      [
        "You are Intelligence, GodMode's built-in AI assistant.",
        "GodMode is the platform; Intelligence is the assistant inside it — never refer to the platform as Intelligence.",
        "Help the user understand their workspace, agents, structure, and automations.",
        "Be concise, actionable, and specific to the data provided. Use markdown formatting.",
        "When you see platform context below, treat it as ground truth for what the user is currently viewing.",
      ].join("\n"),
    defaultEnableThinking: (process.env.LLAMA_ENABLE_THINKING ?? "false") === "true",
    defaultThinkingEfficiency: (process.env.LLAMA_THINKING_EFFICIENCY ?? "normal") as
      | "normal"
      | "low",
    defaultNativeTools: (process.env.LLAMA_NATIVE_TOOLS ?? "true") !== "false",
    /**
     * native = OpenAI-style tools via llama-server --jinja;
     * grammar = JSON-schema constrained decoding.
     * External llama-server (Gemma + --jinja) defaults to native — grammar
     * often loops on empty-arg discovery tools like list_subagents.
     */
    defaultToolMode: (process.env.LLAMA_TOOL_MODE ??
      ((process.env.LLAMA_EXTERNAL ?? "false") === "true" ? "native" : "grammar")) as
      | "native"
      | "grammar",
    adaptersDir:
      process.env.LLAMA_ADAPTERS_DIR ??
      path.join(process.cwd(), "apps", "bridge", "data", "ai", "adapters"),
    datasetsDir:
      process.env.LLAMA_DATASETS_DIR ??
      path.join(process.cwd(), "apps", "bridge", "data", "ai", "datasets"),
    /** HuggingFace id for QLoRA base model (must match active GGUF family). */
    trainBaseModel:
      process.env.LLAMA_TRAIN_BASE_MODEL ?? "unsloth/gemma-3-4b-it",
    /** llama.cpp repo root — used to locate convert_lora_to_gguf.py. */
    llamaCppDir: process.env.LLAMA_CPP_DIR ?? path.join(os.homedir(), "llama.cpp"),
  },
  /**
   * Embedding engine. A SMALL llama-server instance pinned to the CPU
   * (`-ngl 0`) so it never touches the GPU that hosts the main model. The
   * embedder powers semantic (RAG) memory retrieval. Feature-flagged: when
   * disabled (the default) nothing spawns and chat/RAG fall back to recency.
   */
  embeddings: {
    /** Master enable flag. When false nothing spawns and RAG falls back to recency. */
    enabled: (process.env.EMBEDDINGS_ENABLED ?? "false") === "true",
    /** Re-launch the embedder on bridge boot when enabled. */
    autoStart: (process.env.EMBEDDINGS_AUTO_START ?? "true") !== "false",
    /**
     * When true, do not spawn embedder llama-server; attach to
     * serverHost:embedderPort (e.g. host systemd on Docker hub).
     */
    external: (process.env.EMBEDDINGS_EXTERNAL ?? "false") === "true",
    serverHost: process.env.EMBEDDINGS_SERVER_HOST ?? "127.0.0.1",
    /** Embedding model (EmbeddingGemma). Launch with --embeddings --pooling mean. */
    embedderModelPath:
      process.env.EMBEDDINGS_MODEL_PATH ??
      path.join(os.homedir(), "llama.cpp", "models", "embeddinggemma-300M-Q8_0.gguf"),
    embedderPort: Number(process.env.EMBEDDINGS_PORT ?? 8082),
    embedderCtxSize: Number(process.env.EMBEDDINGS_CTX_SIZE ?? 2048),
    /** CPU threads the embedder may use (0 = let llama.cpp decide). */
    threads: Number(process.env.EMBEDDINGS_THREADS ?? 4),
    /** Top-K active memories returned by semantic (cosine) retrieval. */
    ragTopK: Number(process.env.EMBEDDINGS_RAG_TOP_K ?? 12),
    /** Top-K wiki snippets for chat prompt section. */
    wikiRagTopK: Number(process.env.EMBEDDINGS_WIKI_RAG_TOP_K ?? 4),
  },
  holdings: {
    /** AES-256-GCM key (hex). Auto-generated to data dir if absent. */
    secretKey: process.env.HOLDINGS_SECRET_KEY ?? "",
    secretKeyPath: path.join(appData, ".holdings-key"),
    moralisApiKey: process.env.MORALIS_API_KEY ?? "",
    paypalClientId: process.env.PAYPAL_CLIENT_ID ?? "",
    paypalClientSecret: process.env.PAYPAL_CLIENT_SECRET ?? "",
    paypalEnv: (process.env.PAYPAL_ENV ?? "sandbox") as "sandbox" | "live",
    /** Moralis-supported EVM chains for portfolio aggregation. */
    cryptoChains: (
      process.env.HOLDINGS_CRYPTO_CHAINS ??
      "eth,polygon,bsc,arbitrum,optimism,base,avalanche"
    )
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },
  marketplace: {
    officialUrl:
      process.env.MARKETPLACE_OFFICIAL_URL ??
      "https://raw.githubusercontent.com/ReBoticsAI/GodMode-Marketplace/main/catalog/index.json",
    /** Local dev: path to catalog/index.json (sibling GodMode-Marketplace repo). */
    localCatalogPath:
      process.env.MARKETPLACE_LOCAL_CATALOG_PATH ??
      (fs.existsSync(path.join(path.dirname(repoRoot), "GodMode-Marketplace", "catalog", "index.json"))
        ? path.join(path.dirname(repoRoot), "GodMode-Marketplace", "catalog", "index.json")
        : ""),
    cacheTtlMs: Number(process.env.MARKETPLACE_CACHE_TTL_MS ?? 300_000),
    pluginsDir: path.join(appData, "marketplace-plugins"),
    /** Marketplace ToS version buyers/sellers must accept. */
    tosVersion: (process.env.MARKETPLACE_TOS_VERSION ?? "1").trim() || "1",
    /**
     * When set on SaaS, non-SaaS installs should point MARKETPLACE_OFFICIAL_URL here
     * (public Official catalog JSON). Empty = use GitHub/local defaults above.
     */
    saasOfficialCatalogUrl: (process.env.MARKETPLACE_SAAS_OFFICIAL_URL ?? "").trim(),
    payments: {
      stripeEnabled: Boolean(
        (process.env.STRIPE_SECRET_KEY ?? "").trim() ||
          (process.env.STRIPE_MARKETPLACE_WEBHOOK_SECRET ?? "").trim()
      ),
      stripeWebhookSecret: (process.env.STRIPE_MARKETPLACE_WEBHOOK_SECRET ?? "").trim(),
      paypalEnabled: Boolean(
        (process.env.PAYPAL_CLIENT_ID ?? process.env.PAYPAL_MARKETPLACE_CLIENT_ID ?? "").trim() &&
          (
            process.env.PAYPAL_CLIENT_SECRET ??
            process.env.PAYPAL_MARKETPLACE_CLIENT_SECRET ??
            ""
          ).trim()
      ),
      paypalClientId: (
        process.env.PAYPAL_MARKETPLACE_CLIENT_ID ??
        process.env.PAYPAL_CLIENT_ID ??
        ""
      ).trim(),
      paypalClientSecret: (
        process.env.PAYPAL_MARKETPLACE_CLIENT_SECRET ??
        process.env.PAYPAL_CLIENT_SECRET ??
        ""
      ).trim(),
      paypalEnv: (process.env.PAYPAL_ENV ?? "sandbox") as "sandbox" | "live",
      paypalWebhookId: (process.env.PAYPAL_MARKETPLACE_WEBHOOK_ID ?? "").trim(),
      cryptoTreasuryAddress: (process.env.MARKETPLACE_CRYPTO_TREASURY_ADDRESS ?? "").trim(),
      cryptoChainId: Number(process.env.MARKETPLACE_CRYPTO_CHAIN_ID ?? 1),
      cryptoAsset: (process.env.MARKETPLACE_CRYPTO_ASSET ?? "USDC").trim() || "USDC",
      /** Platform Connect application fee is fixed at 10% in code. */
      platformFeeBps: 1000,
    },
  },
};

/** Filesystem-safe slug for an agent id (used as the sandbox folder name). */
export function slugAgentId(agentId: string): string {
  return (agentId || "").replace(/[^a-zA-Z0-9._-]/g, "_") || "agent";
}

/** Root sandbox/workspace directory for a single agent. */
export function agentDir(agentId: string): string {
  return path.join(appData, "agents", slugAgentId(agentId));
}

/** Per-agent artifacts directory (real files registered in ai_artifacts). */
export function agentArtifactsDir(agentId: string): string {
  return path.join(agentDir(agentId), "artifacts");
}

/** Per-tenant sandbox root for coding tools (Intelligence self-expansion). */
export function tenantWorkspaceDir(tenantId: string): string {
  return path.join(config.tenantWorkspacesDir, tenantId);
}
