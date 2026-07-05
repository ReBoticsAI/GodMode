# Configuration

Bridge reads environment variables from `apps/bridge/.env` (copy from `.env.example`). Web dev server proxies `/api` to Bridge; set `BRIDGE_TARGET` if Bridge runs on a non-default host/port.

## Auth and deployment

| Variable | Default | Description |
|----------|---------|-------------|
| `DEPLOYMENT_MODE` | `local` | `local`, `hub`, or `client` |
| `AUTH_PUBLIC_URL` | `http://127.0.0.1:3847` | Bridge URL for session cookies |
| `WEB_PUBLIC_URL` | `http://127.0.0.1:5173` | Dashboard URL |
| `WEB_ORIGIN` | same as web URL | CORS allowed origin(s), comma-separated |
| `CORS_PERMISSIVE` | unset | Set `true` to allow any Origin in non-production (dev only) |
| `AUTH_SESSION_SECRET` | dev placeholder | **Required in production** — random secret |
| `AUTH_ALLOW_ANONYMOUS` | `false` | Set `true` only for headless local tooling |
| `AUTH_ALLOW_SIGNUP` | `true` (local) | Open signup; hub defaults to invite flow |
| `AUTH_INVITE_CODES` | empty | Comma-separated codes required for hub signup |
| `INITIAL_ADMINS` | empty | `Name:email` pairs; first signup is admin when empty |
| `INITIAL_ADMIN_PASSWORD` | empty | Optional password for seeded admins |
| `AUTH_SESSION_TTL_DAYS` | `30` | Session lifetime |

## Bridge and data paths

| Variable | Default | Description |
|----------|---------|-------------|
| `BRIDGE_PORT` | `3847` | HTTP + WebSocket port |
| `BRIDGE_HOST` | `127.0.0.1` | Bind address |
| `PLATFORM_DATA_DIR` | OS app data | SQLite and runtime files |
| `PLATFORM_REPO_ROOT` | auto | Monorepo root override |

## Plugins and marketplace

| Variable | Default | Description |
|----------|---------|-------------|
| `GODMODE_PLUGIN_PATH` | empty | Optional advanced override: semicolon-separated plugin roots (Windows). Prefer **Marketplace → Unofficial** for UI-based install. |
| `GITHUB_TOKEN` | empty | Clone private GitHub plugin repos from Marketplace |
| `GODMODE_PLUGIN_SCAFFOLD_DIR` | `~/godmode-plugins` | Target dir for `scaffold_plugin` tool |
| `MARKETPLACE_OFFICIAL_URL` | GitHub raw index | Official catalog URL |
| `MARKETPLACE_LOCAL_CATALOG_PATH` | auto-detect sibling | Local catalog file path |
| `MARKETPLACE_CACHE_TTL_MS` | `300000` | Catalog cache TTL |

## Federation

| Variable | Default | Description |
|----------|---------|-------------|
| `FEDERATION_TOKEN` | empty | Shared secret for peer Bridge API |
| `FEDERATION_PUBLIC_URL` | Bridge URL | Public base URL for remote peers |

## Hub-only (SaaS)

| Variable | Description |
|----------|-------------|
| `CLOUD_HUB_URL` | Official hub for client-mode marketplace |
| `STRIPE_SECRET_KEY` | Marketplace credits billing |
| `STRIPE_CREDITS_PER_USD` | Credit conversion rate |

Not used in local OSS installs.

## LLM (local inference)

| Variable | Default | Description |
|----------|---------|-------------|
| `LLAMA_SERVER_BIN` | `~/llama.cpp/bin/llama-server` | llama-server binary |
| `LLAMA_SERVER_HOST` | `127.0.0.1` | Inference server host |
| `LLAMA_SERVER_PORT` | `8080` | Inference server port |
| `LLAMA_MODEL_DIRS` | search paths | Semicolon-separated model directories |
| `LLAMA_CTX_SIZE` | `262144` | Total context across parallel slots |
| `LLAMA_GPU_LAYERS` | `99` | GPU layer offload |
| `EMBEDDINGS_ENABLED` | `false` | Semantic memory RAG embedder |

See `apps/bridge/src/config.ts` for the full list of `LLAMA_*` tuning flags.

## Optional integrations

| Variable | Description |
|----------|-------------|
| `HOLDINGS_SECRET_KEY` | AES key for holdings encryption |
| `MORALIS_API_KEY` | Crypto balance lookups |
| `PAYPAL_*` | PayPal sandbox/live for Bank |
| `DTC_*` | Trade service socket (plugin domain) |

Domain-specific paths (chart host directories, codegen output, backtest charts) are set by optional plugins via their own env documentation — OSS core defaults these to empty.

## Web dev

| Variable | Description |
|----------|-------------|
| `BRIDGE_TARGET` | Vite proxy target (default `http://127.0.0.1:3847`) |

Full template: [apps/bridge/.env.example](../apps/bridge/.env.example).
