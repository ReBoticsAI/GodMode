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
| `AUTH_ALLOW_SIGNUP` | `true` (local) | Open signup; hub/SaaS keep `false` (SaaS unlocks via Checkout) |
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
| `GODMODE_PLUGIN_PATH` | empty | Optional advanced override: semicolon-separated plugin roots (Windows). Prefer **Marketplace → Unofficial** or Intelligence `install_plugin`. |
| `GITHUB_TOKEN` | empty | Clone private GitHub plugin repos from Marketplace |
| `GODMODE_PLUGIN_SCAFFOLD_DIR` | `{repo}/plugins` (local) or tenant workspace `plugins/` (hub) | Override target dir for `scaffold_plugin` |
| `MARKETPLACE_OFFICIAL_URL` | GitHub raw index | Official catalog URL |
| `MARKETPLACE_LOCAL_CATALOG_PATH` | auto-detect sibling | Local catalog file path |
| `MARKETPLACE_CACHE_TTL_MS` | `300000` | Catalog cache TTL |

## Federation

| Variable | Default | Description |
|----------|---------|-------------|
| `FEDERATION_TOKEN` | empty | Shared secret for peer Bridge API |
| `FEDERATION_PUBLIC_URL` | Bridge URL | Public base URL for remote peers |

## Releases and updates

| Variable | Default | Description |
|----------|---------|-------------|
| `GODMODE_VERSION` | package version | Immutable installed platform version |
| `GODMODE_IMAGE` | release compose default | Digest-pinned GHCR image consumed by production compose |
| `INSTALLATION_SURFACE` | `developer_source` | `saas`, `private_hub`, `docker`, `linux_bare_metal`, `windows_bare_metal`, `electron`, or unsupported developer source |
| `UPDATE_CHANNEL` | `stable` | Release channel: `stable` or `nightly` |
| `UPDATE_MANIFEST_URL` | official channel URL | HTTPS release manifest override |
| `UPDATE_FETCH_TIMEOUT_MS` | `10000` | Manifest request timeout |
| `UPDATE_POLL_MIN_MS` | `14400000` | Minimum randomized automatic-check interval |
| `UPDATE_POLL_MAX_MS` | `28800000` | Maximum randomized automatic-check interval |
| `UPDATE_SNAPSHOT_DIR` | sibling of platform data | External destination for coordinated update snapshots |
| `UPDATE_READINESS_TOKEN` | empty | Dedicated bearer token for the host updater's deep-readiness endpoint |
| `UPDATE_SUPERVISOR_URL` | empty | Optional authenticated local host-supervisor endpoint for one-click apply |
| `UPDATE_SUPERVISOR_TOKEN` | empty | Independent bearer token shared only with that host supervisor |

Publisher identity and trust-root settings are documented in
[RELEASES.md](./RELEASES.md). Production update checks must remain disabled
unless a trusted signature-verification policy is configured.

## Hub-only (SaaS)

| Variable | Description |
|----------|-------------|
| `INSTALLATION_SURFACE` | `saas` enables the paid signup paywall; `private_hub` is self-hosted multi-tenant without it |
| `CLOUD_HUB_URL` | Official hub for client-mode marketplace |
| `STRIPE_SECRET_KEY` | Stripe secret (paywall + marketplace credits) |
| `STRIPE_SAAS_PRICE_ID` | Stripe Price ID for SaaS Checkout (`INSTALLATION_SURFACE=saas`) |
| `STRIPE_SAAS_CHECKOUT_MODE` | `payment` (default) or `subscription` |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for `/api/saas/stripe/webhook` |
| `STRIPE_CREDITS_PER_USD` | Marketplace credit conversion rate |

Not used in local OSS installs. Private hubs ignore SaaS paywall env vars.

## LLM (local inference)

| Variable | Default | Description |
|----------|---------|-------------|
| `LLAMA_SERVER_BIN` | `~/llama.cpp/bin/llama-server` | llama-server binary (ignored when `LLAMA_EXTERNAL=true`) |
| `LLAMA_EXTERNAL` | `false` | Attach to an already-running server; do not spawn or kill it |
| `LLAMA_SERVER_HOST` | `127.0.0.1` | Inference server host (`host.docker.internal` from Docker) |
| `LLAMA_SERVER_PORT` | `8080` | Inference server port |
| `LLAMA_MODEL_DIRS` | search paths | Semicolon-separated model directories |
| `LLAMA_CTX_SIZE` | `262144` | Total context across parallel slots (host-managed when external) |
| `LLAMA_GPU_LAYERS` | `99` | GPU layer offload |
| `LLAMA_THREADS` | `0` | CPU threads (`0` = llama.cpp default) |
| `LLAMA_EXTRA_ARGS` | empty | Extra llama-server flags when Bridge spawns the process |
| `EMBEDDINGS_ENABLED` | `false` | Semantic memory RAG embedder |
| `EMBEDDINGS_EXTERNAL` | `false` | Attach to host embedder; do not spawn inside the container |
| `EMBEDDINGS_SERVER_HOST` | `127.0.0.1` | Embedder host (`host.docker.internal` from Docker) |
| `EMBEDDINGS_PORT` | `8082` | Embedder llama-server port |
| `EMBEDDINGS_MODEL_PATH` | `~/llama.cpp/models/embeddinggemma-300M-Q8_0.gguf` | GGUF for spawn mode |
| `EMBEDDINGS_AUTO_START` | `true` | Start/attach embedder when enabled |
| `EMBEDDINGS_RAG_TOP_K` | `12` | Memory hybrid top-K |
| `EMBEDDINGS_WIKI_RAG_TOP_K` | `4` | Wiki hybrid top-K for chat |

See [AGENT_MEMORY.md](./AGENT_MEMORY.md) and [LOCAL_LLM.md](./LOCAL_LLM.md).

## Optional integrations

| Variable | Description |
|----------|-------------|
| `CURSOR_API_KEY` | Cursor User API key for Intelligence `cursor_cloud` (overrides Vault). See [CURSOR_SUBSCRIPTION.md](./CURSOR_SUBSCRIPTION.md). |
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
