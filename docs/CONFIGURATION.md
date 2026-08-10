# Configuration

Bridge reads environment variables from `apps/bridge/.env` (copy from `.env.example`). Web dev server proxies `/api` to Bridge; set `BRIDGE_TARGET` if Bridge runs on a non-default host/port.

## Auth and deployment

Sign-in OAuth (Google / GitHub App) is documented below. **LLM subscription OAuth** active residual for #355 is Copilot, GitLab Duo, and SuperGrok (Codex scrapped; Amazon Q / Kiro deferred / later); see [Vault OAuth subscription providers](./features/vault-oauth-subscriptions.md). Do not commit provider OAuth client secrets into the public repo. When a subscription OAuth Connect card ships, register apps on the host and set env client id/secret with redirect `{AUTH_PUBLIC_URL}/api/integrations/<provider>/callback`.

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
| `EMAIL_PROVIDER` | `none` | `none`, `resend`, or `smtp` (required in production SaaS) |
| `EMAIL_FROM` | `GodMode <noreply@localhost>` | From header for transactional mail (must be a Resend-verified domain in SaaS) |
| `RESEND_API_KEY` | empty | Real Resend API key when `EMAIL_PROVIDER=resend` (not the `re_...` placeholder) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` | empty | SMTP transport when `EMAIL_PROVIDER=smtp` |
| `BUSINESS_WEBSITE_URL` | empty | Public marketing site URL (Stripe business website) |
| `OAUTH_GOOGLE_CLIENT_ID` / `OAUTH_GOOGLE_CLIENT_SECRET` | empty | Google OAuth for sign-in (optional) |
| `OAUTH_GITHUB_CLIENT_ID` / `OAUTH_GITHUB_CLIENT_SECRET` | empty | **Deprecated** classic GitHub OAuth for sign-in. Unused when `GITHUB_APP_*` is set; keep only as local/dev fallback |
| `OAUTH_GITHUB_INTEGRATION_CLIENT_ID` / `OAUTH_GITHUB_INTEGRATION_CLIENT_SECRET` | falls back to login GitHub client | **Deprecated** classic Tasks ↔ Projects OAuth. Unused when `GITHUB_APP_*` is set |
| `GITHUB_APP_ID` / `GITHUB_APP_CLIENT_ID` / `GITHUB_APP_CLIENT_SECRET` | empty | **Preferred** GitHub App for sign-in + Connect + webhooks + Core Support issues |
| `GITHUB_APP_PRIVATE_KEY_PATH` or `GITHUB_APP_PRIVATE_KEY` | empty | App private key (PEM path preferred on production hosts) |
| `GITHUB_APP_WEBHOOK_SECRET` | empty | App webhook HMAC secret |
| `BACKUP_LOCAL_DIR` | `{data}/backups` | Local snapshot directory (stamps include `databases/Cloud.sqlite`, `core.sqlite` alias, `Users.sqlite`, `users/*.sqlite`, tenants, timeseries) |
| `BACKUP_S3_ENDPOINT` / `BACKUP_S3_BUCKET` / `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY` | empty | Optional S3-compatible offsite upload (PC download is the default offsite path; see [DEPLOY.md](../DEPLOY.md)) |
| `BACKUP_S3_REGION` / `BACKUP_S3_PREFIX` | `auto` / `godmode/` | Optional offsite region/prefix when using S3/R2 |
| `PLATFORM_SAAS_ALLOW_CODE_ACCESS` | SaaS: `true` when unset; else `false` | When SaaS, allow agent coding/terminal + Coding UI (#178). Opt out with `false`. Non-SaaS ignores this gate. |
| `PLATFORM_SPEND_DISABLED` | unset | When `true`/`1`, force deny all spend (credits debit, chat, autonomous/queue) before `platform_meta` (#96 Slice 3) |
| `PLATFORM_DEPLOY_DISABLED` | unset | When `true`/`1`, force deny plugin build/activate and worktree promote before `platform_meta` (#96 Slice 4) |
| `PLATFORM_DELETE_DISABLED` | unset | When `true`/`1`, force deny record/FS/wiki/plugin uninstall deletes before `platform_meta` (#96 Slice 5) |
| `PLATFORM_SEND_DISABLED` | unset | When `true`/`1`, force deny hook webhook/send_message before `platform_meta` (#96 Slice 6) |
| `PLATFORM_AGENTS_DISABLED` | unset | When `true`/`1`, force deny agent LLM execution before `platform_meta` (#96 Slice 8) |
| `PLATFORM_SAAS_ALLOW_LOCAL_PLUGINS` | `false` | When SaaS, allow Local path plugin registration (keep false) |
| `CODING_BUILD_MODE` | `off` | Layer 4 (#164): `off` or `ephemeral` (delegate allowlisted npm builds to host supervisor) |
| `CODING_BUILD_SUPERVISOR_URL` | empty | Localhost HTTP base for build supervisor (`127.0.0.1`, `localhost`, or `host.docker.internal`) |
| `CODING_BUILD_SUPERVISOR_TOKEN` | empty | Bearer token shared only with the build supervisor |
| `CODING_BUILD_NET` | `none` | Layer 4 build-container network (#167 / #170): `none` or `allowlist` (`shared` unsupported). `allowlist` uses a Docker `--internal` network plus host CONNECT proxy |
| `CODING_BUILD_EGRESS_HOSTS` | empty | Optional comma-separated CONNECT hosts for `allowlist` (falls back to `CODING_TERMINAL_EGRESS_HOSTS`, then npm/GitHub defaults) |
| `CODING_BUILD_EGRESS_NETWORK` | `godmode-build-egress` | Docker network name for `allowlist` builds (created with `--internal` if missing; fails closed if a non-internal network already uses the name) |
| `CODING_BUILD_GLOBAL_CONCURRENCY` | `2` (supervisor) | Max concurrent Layer 4 builds platform-wide (#96 Slice 1) |
| `CODING_BUILD_TENANT_CONCURRENCY` | `1` (supervisor) | Max concurrent Layer 4 builds per tenant |
| `CODING_TERMINAL_GLOBAL_CONCURRENCY` | hub/SaaS: `4`; local: unlimited | Max concurrent `run_terminal` runs platform-wide |
| `CODING_TERMINAL_TENANT_CONCURRENCY` | hub/SaaS: `2`; local: unlimited | Max concurrent `run_terminal` runs per tenant |
| `CODING_PTY_MAX_PER_TENANT` | hub/SaaS: `3`; local: unlimited | Max open shared PTY sessions per tenant |
| `CODING_HOOK_EXECUTION` | `on` | Run Automations gates on coding write/shell tools. Set `off` for discovery-only (create/list hooks, no coding execution) |
| `CURSOR_SDK_SANDBOX` | hub/client Linux: `required`; else `off` | Enable Cursor SDK `sandboxOptions` for `cursor_cloud` built-in Shell/FS (#171). GodMode customTools still use Bridge Layer 3. Fail closed when `required` and the SDK sandbox helper is missing |

### SaaS coding + Layer 4 (staging/prod)

On `INSTALLATION_SURFACE=saas`, coding is **on by default** (#178). Set `PLATFORM_SAAS_ALLOW_CODE_ACCESS=false` to disable Coding UI and agent `codeAccess`. Keep `PLATFORM_SAAS_ALLOW_LOCAL_PLUGINS=false`.

**Layer 3** (already default on hub/client Linux): `CODING_TERMINAL_SANDBOX=required`, `CODING_TERMINAL_NET=none`. For npm/git from the terminal, set `CODING_TERMINAL_NET=allowlist` (optional). Docker Bridge needs `cap_add: [SYS_ADMIN, NET_ADMIN]` and matching `security_opt` so bubblewrap namespaces work (see `deploy/docker-compose.saas-staging.yml`).

**Layer 4** for SaaS staging/prod:

1. Run `deploy/build-supervisor/` on the host against the **SaaS** `PLATFORM_DATA_DIR` only (separate supervisor or token from any private_hub data root).
2. Bridge env: `CODING_BUILD_MODE=ephemeral`, `CODING_BUILD_SUPERVISOR_URL=http://host.docker.internal:8792`, shared `CODING_BUILD_SUPERVISOR_TOKEN`, `CODING_BUILD_NET=allowlist` (registry egress for demos).
3. Do not mount `docker.sock` into Bridge. Residual shared-host risk is tracked in #172.

Templates: [deploy/.env.saas-staging.example](../deploy/.env.saas-staging.example), [deploy/.env.production.example](../deploy/.env.production.example).

**Coding quotas + kill switches (#96 Slice 1–2):** hub/SaaS defaults above limit noisy-neighbor terminal/PTY/build load. Rejects are audited in `tool_audit_log` with stable codes (`quota:*`, `kill:*`).

**Spend hard-stop (#96 Slice 3):** runtime global/per-tenant spend kills block credit debits, Intelligence chat, and autonomous/queue work. Optional env nuclear: `PLATFORM_SPEND_DISABLED=true`. Full budgets/accounting remain #91.

**Deploy hard-stop (#96 Slice 4):** runtime global/per-tenant deploy kills block plugin esbuild, `activatePluginForTenant` / marketplace install, and worktree promote. Distinct from Coding Layer 4 `builds_disabled`. Optional env nuclear: `PLATFORM_DEPLOY_DISABLED=true`. Boot reconcile installs stay ungated so restart recovery is not bricked. CLI `godmode-plugins-cli` remains an ops bypass.

**Delete hard-stop (#96 Slice 5):** runtime global/per-tenant delete kills block kernel `deleteRecord`, coding `deleteFile`/`deletePath`, wiki `deletePage`, and plugin uninstall. Optional env nuclear: `PLATFORM_DELETE_DISABLED=true`. Reconcile uninstalls and failed-install compensation stay exempt. Platform-admin `wipeWorkspaceTenant` stays ungated. CLI uninstall remains an ops bypass.

**Send hard-stop (#96 Slice 6):** runtime global/per-tenant send kills block hook `webhook` and `send_message` actions (automation outbound). Optional env nuclear: `PLATFORM_SEND_DISABLED=true`. Auth verification/reset mail, human DMs, agent conversational replies, and in-app `notify` stay ungated.

**Agent pause (#96 Slice 8):** runtime global/per-tenant/per-agent pause blocks agent LLM execution (chat, autonomous, queue agent jobs, subagents, replies). Optional env nuclear: `PLATFORM_AGENTS_DISABLED=true`. Does not mutate `ai_agents.enabled`. Distinct from spend kill and user disable toggles.

**Admin → Authority** (`?tab=authority`) is the durable ops UI for this epic: global/per-tenant kill toggles, configured limits, live load, and a unified audit feed (#96 Slice 7). API also available:

- `GET /api/admin/authority/coding-status`
- `GET /api/admin/authority/coding-events`
- `GET /api/admin/authority/coding-kills`
- `POST /api/admin/authority/coding-kills/global` body `{ "codingDisabled": true, "buildsDisabled": false }`
- `POST /api/admin/authority/coding-kills/tenant/:tenantId` same shape
- `GET /api/admin/authority/spend-status`
- `GET /api/admin/authority/spend-events`
- `GET /api/admin/authority/spend-kills`
- `POST /api/admin/authority/spend-kills/global` body `{ "spendDisabled": true }`
- `POST /api/admin/authority/spend-kills/tenant/:tenantId` same shape
- `GET /api/admin/authority/deploy-status`
- `GET /api/admin/authority/deploy-events`
- `GET /api/admin/authority/deploy-kills`
- `POST /api/admin/authority/deploy-kills/global` body `{ "deployDisabled": true }`
- `POST /api/admin/authority/deploy-kills/tenant/:tenantId` same shape
- `GET /api/admin/authority/delete-status`
- `GET /api/admin/authority/delete-events`
- `GET /api/admin/authority/delete-kills`
- `POST /api/admin/authority/delete-kills/global` body `{ "deleteDisabled": true }`
- `POST /api/admin/authority/delete-kills/tenant/:tenantId` same shape
- `GET /api/admin/authority/send-status`
- `GET /api/admin/authority/send-events`
- `GET /api/admin/authority/send-kills`
- `POST /api/admin/authority/send-kills/global` body `{ "sendDisabled": true }`
- `POST /api/admin/authority/send-kills/tenant/:tenantId` same shape
- `GET /api/admin/authority/audit-events?limit=&domain=&tenantId=`
- `GET /api/admin/authority/agent-pause-status`
- `GET /api/admin/authority/agent-pause-events`
- `GET /api/admin/authority/agent-pause-kills`
- `POST /api/admin/authority/agent-pause-kills/global` body `{ "agentsPaused": true }`
- `POST /api/admin/authority/agent-pause-kills/tenant/:tenantId` same shape
- `POST /api/admin/authority/agent-pause-kills/tenant/:tenantId/agent/:agentId` body `{ "paused": true }`

`PLATFORM_SAAS_ALLOW_CODE_ACCESS=false` remains the env-level nuclear opt-out for all coding. `PLATFORM_SPEND_DISABLED=true` forces spend deny even before `platform_meta`. `PLATFORM_DEPLOY_DISABLED=true` forces deploy deny even before `platform_meta`. `PLATFORM_DELETE_DISABLED=true` forces delete deny even before `platform_meta`. `PLATFORM_SEND_DISABLED=true` forces send deny even before `platform_meta`. `PLATFORM_AGENTS_DISABLED=true` forces agent execution pause even before `platform_meta`.

### GitHub App (sign-in + Connect + Projects webhooks)

**Preferred** for SaaS: one GitHub App (`GITHUB_APP_*`) covers sign-in, Settings Connect, Projects sync/webhooks, and Core Support issue create. Classic `OAUTH_GITHUB_*` / `OAUTH_GITHUB_INTEGRATION_*` are deprecated and only used when the App client id/secret are unset (local/dev fallback). Do not register new classic OAuth Apps for GodMode Cloud.

| Variable | Description |
|----------|-------------|
| `GITHUB_APP_ID` | Numeric App ID |
| `GITHUB_APP_CLIENT_ID` | App client ID (also used for sign-in + Connect OAuth) |
| `GITHUB_APP_CLIENT_SECRET` | App client secret |
| `GITHUB_APP_PRIVATE_KEY_PATH` | Path to downloaded `.pem` on the host (preferred) |
| `GITHUB_APP_PRIVATE_KEY` | PEM contents with `\n` escapes (alternative to path) |
| `GITHUB_APP_WEBHOOK_SECRET` | Webhook secret from App settings |
| `GITHUB_APP_SLUG` | Install URL slug (default `godmode-cloud`) |
| `GITHUB_APP_PLATFORM_INSTALLATION_ID` | Optional install id on the platform account for Core Support issues |
| `GITHUB_APP_PLATFORM_ACCOUNT_LOGIN` | Account login for platform install discovery (default `ReBoticsAI`) |

Callback URLs on the App (add both):
| Purpose | Callback URL |
|---------|----------------|
| Sign-in | `{AUTH_PUBLIC_URL}/api/auth/oauth/github/callback` |
| Connect / install | `{AUTH_PUBLIC_URL}/api/integrations/github/callback` |

Webhook URL: `{AUTH_PUBLIC_URL}/api/integrations/github/webhook` (subscribe to Projects v2 item + installation events).

**Projects webhooks note:** Live `projects_v2_item` delivery is **organization-level only** (GitHub limitation). User-owned Projects (for example `users/*/projects/N`) sync via the **1-minute poll** (or manual Sync). The Bridge HMAC webhook handler is ready for org-owned Projects when the App is installed on that org.

### Deprecated classic GitHub OAuth apps

Only when `GITHUB_APP_CLIENT_ID` / `GITHUB_APP_CLIENT_SECRET` are not configured:

| Variable | Default | Description |
|----------|---------|-------------|
| `OAUTH_GITHUB_CLIENT_ID` / `OAUTH_GITHUB_CLIENT_SECRET` | empty | Classic OAuth for **sign-in** |
| `OAUTH_GITHUB_INTEGRATION_CLIENT_ID` / `OAUTH_GITHUB_INTEGRATION_CLIENT_SECRET` | falls back to login GitHub client | Classic OAuth for Tasks ↔ Projects |

On GodMode Cloud, classic `OAUTH_GITHUB_*` / `OAUTH_GITHUB_INTEGRATION_*` are already blanked once `GITHUB_APP_*` is set. They are not required for sign-in or Connect. After you confirm App-only Connect and GitHub sign-in work in production, you can delete the unused classic OAuth Apps at [github.com/settings/developers](https://github.com/settings/developers) (OAuth Apps). No need to keep them archived.

Register callback URLs on a classic OAuth App only for local/dev without a GitHub App:

| Purpose | Callback URL |
|---------|----------------|
| Sign-in | `{AUTH_PUBLIC_URL}/api/auth/oauth/github/callback` |
| Tasks ↔ GitHub Projects | `{AUTH_PUBLIC_URL}/api/integrations/github/callback` |

Linked Tasks boards poll GitHub on an interval (last-write-wins with manual Sync / push-on-edit). Default poll is **1 minute** (near-real-time for user-owned boards). Live `projects_v2_item` webhooks require an **org-owned** Project with the App installed on that org; the Bridge webhook handler is ready, but GitHub does not emit item events for user-owned Projects. Poll covers user boards and acts as backup for org boards.

| Variable | Default | Description |
|----------|---------|-------------|
| `GITHUB_PROJECTS_SYNC_POLL_ENABLED` | on (unset) | Set to `0` to disable background poll |
| `GITHUB_PROJECTS_SYNC_POLL_MS` | `60000` | Poll interval in ms (clamped 1-30 min; min 60000) |

## Bridge and data paths

| Variable | Default | Description |
|----------|---------|-------------|
| `BRIDGE_PORT` | `3847` | HTTP + WebSocket port |
| `BRIDGE_HOST` | `127.0.0.1` | Bind address |
| `PLATFORM_DATA_DIR` | OS app data | SQLite and runtime files (`Cloud.sqlite` Cloud plane, `Users.sqlite` hub, `users/*.sqlite` Platform Vault / User DB, `tenants/*.sqlite` workspaces, backups). Cloud owners can download their workspace file from Settings; place it under `PLATFORM_DATA_DIR/tenants/` for local restore (see [multi-tenant-model.md](./multi-tenant-model.md#tenant-export-cloud-to-local)). |
| `PLATFORM_REPO_ROOT` | auto | Monorepo root override |

## Plugins and marketplace

| Variable | Default | Description |
|----------|---------|-------------|
| `GODMODE_FEATURES_DIR` | `{repo}/docs/features` | Directory of feature markdown used to seed platform wiki pages. Production images must ship `/app/docs/features` (see `deploy/Dockerfile`); override only if mounting docs from the host. |
| `GODMODE_PLUGIN_PATH` | empty | Optional advanced override: semicolon-separated plugin roots (Windows). Prefer **Marketplace → Local** or Intelligence `install_plugin`. |
| `GITHUB_TOKEN` | empty | Clone private GitHub plugin repos from Marketplace |
| `GODMODE_PLUGIN_SCAFFOLD_DIR` | `{repo}/plugins` (local) or tenant workspace `plugins/` (hub) | Override target dir for `scaffold_plugin` |
| `MARKETPLACE_OFFICIAL_URL` | GitHub `catalog/official/index.json` | Official (ReBotics-only) catalog URL |
| `MARKETPLACE_COMMUNITY_URL` | GitHub `catalog/community/index.json` | Community (user seller) gated catalog URL |
| `MARKETPLACE_LOCAL_CATALOG_PATH` | sibling `catalog/official/index.json` | Local Official index for dev |
| `MARKETPLACE_LOCAL_COMMUNITY_CATALOG_PATH` | sibling `catalog/community/index.json` | Local Community index for dev |
| `MARKETPLACE_SAAS_OFFICIAL_URL` | empty | Remote SaaS Official catalog for local/private-hub price enrichment |
| `MARKETPLACE_CACHE_TTL_MS` | `300000` | Catalog cache TTL |
| `MARKETPLACE_TOS_VERSION` | `1` | Marketplace ToS version buyers/sellers must accept |
| `MARKETPLACE_CRYPTO_TREASURY_ADDRESS` | empty | Platform treasury address for crypto checkout |
| `MARKETPLACE_CRYPTO_CHAIN_ID` | `1` | EVM chain id for crypto payments |
| `MARKETPLACE_CRYPTO_ASSET` | `USDC` | Display asset label for crypto checkout |
| `STRIPE_MARKETPLACE_WEBHOOK_SECRET` | empty | Stripe webhook secret for Marketplace orders (falls back to `STRIPE_WEBHOOK_SECRET`) |
| `PAYPAL_MARKETPLACE_CLIENT_ID` / `SECRET` | holdings PayPal | PayPal app credentials for Marketplace (falls back to `PAYPAL_CLIENT_*`) |
| `PAYPAL_MARKETPLACE_WEBHOOK_ID` | empty | Optional PayPal webhook id metadata |

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
| `STRIPE_SECRET_KEY` | Stripe secret (SaaS paywall + Marketplace Checkout) |
| `STRIPE_SAAS_PRICE_MONTHLY` | Recurring monthly Price ID (`$9.99 USD/mo`) |
| `STRIPE_SAAS_PRICE_YEARLY` | Recurring yearly Price ID (`$74.99 USD/yr`) |
| `STRIPE_SAAS_PRICE_ID` | Optional single-price fallback if monthly/yearly unset |
| `STRIPE_SAAS_CHECKOUT_MODE` | `subscription` (default when plan prices set) or `payment` |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for `/api/saas/stripe/webhook` (`checkout.session.completed`, `customer.subscription.*`, `invoice.payment_failed`) |
| `STRIPE_CREDITS_PER_USD` | Marketplace credit conversion rate |

On SaaS installs, authenticated users open Stripe Customer Portal via
`POST /api/saas/portal` (Platform Vault → GodMode Cloud → Manage subscription). Platform admins list
customers at `GET /api/admin/saas/customers`.

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
| `CURSOR_SDK_SANDBOX` | Hub/client Linux default `required`; win32/local `off`. See coding isolation table above. |
| `HOLDINGS_SECRET_KEY` | AES key for holdings encryption |
| `MORALIS_API_KEY` | Crypto balance lookups |
| `PAYPAL_*` | PayPal sandbox/live for Bank |

### Exa web tools (BYOK)

Agent `web_search` / `fetch_url` on **Cloud SaaS** (`INSTALLATION_SURFACE=saas`) require a tenant or agent Exa API key. There is **no** platform `EXA_API_KEY` env fallback (shared pool is intentionally not used).

| Where | How |
|-------|-----|
| Vault | Secret name `exa_api_key` |
| Agent accounts | Provider `exa` (API key) |

Self-host / local: Exa is optional. With a key, tools use Exa's search/contents APIs; without a key, DuckDuckGo / direct fetch remain available. See [vault feature doc](./features/vault.md).

Domain-specific paths (chart host directories, codegen output, backtest charts) are set by optional plugins via their own env documentation — OSS core defaults these to empty.

## Web dev

| Variable | Description |
|----------|-------------|
| `BRIDGE_TARGET` | Vite proxy target (default `http://127.0.0.1:3847`) |

Full template: [apps/bridge/.env.example](../apps/bridge/.env.example).
