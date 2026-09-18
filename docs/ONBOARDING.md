# Onboarding

Each **workspace (tenant)** runs the **FirstRunWizard** on first use until that workspace marks an LLM as ready (or you choose the cloud/Vault path). Completing onboarding for one account does **not** dismiss it for others. That matters for multi-user hubs.

![Home after onboarding](assets/readme/hero-home.png)

## When the wizard shows

The web client calls `GET /api/onboarding/status` after the user is authenticated and past SaaS gates (email verified; platform admins also need MFA). The wizard opens when both `completed` and `llmReady` are false for the **active tenant**.

On SaaS, unverified users cannot call product APIs (`403 EMAIL_NOT_VERIFIED`). The client waits until email verification succeeds, then re-checks status. A hard refresh after verify also re-runs the gate.

Flags live in the tenant SQLite `ai_settings` table (`onboarding.completed`, `onboarding.llm_ready`). Browser `localStorage` is updated when the wizard finishes but is **not** the source of truth for showing it.

On multi-tenant hubs, a process-wide `CURSOR_API_KEY` does **not** mark every workspace `llmReady`. Only a Platform Vault Cursor key (or an explicit `onboarding.llm_ready` flag) does.

## Steps

### Self-host / desktop / private hub

1. **Welcome**: overview of Intelligence and workspace areas.
2. **Choose your LLM**: llama.cpp is the primary local stack (pick a GGUF model when present). Ollama and LM Studio are additional options. Open Vault → Inference for cloud keys, or continue after starting a local model.
3. **Connect Exa (optional)**: explain web search / fetch for agents; Open Vault → Inference → Search. Continue without requiring Exa.
4. **Ready**: Get started opens Chat (Intelligence panel) and Marketplace starter packs remain available anytime.

### GodMode Cloud (`INSTALLATION_SURFACE=saas`)

1. **Welcome**: same overview.
2. **Connect your LLM**: explain subscription (use your plan, for example Cursor) vs metered Platform API keys. Status badge; Continue gated on `llmReady`. Open Vault → `/vault?tab=inference`. Skip for now remains available.
3. **Connect Exa (optional)**: explain Exa for agent web_search / fetch_url; Open Vault → `/vault?tab=search`. Continue without requiring Exa; optional Connected badge when `exa_api_key` is present.
4. **Ready**: Get started runs `completeOnboarding`, navigates Home, and opens the Intelligence chat panel.

Soft-dismiss (Open Vault) pauses the wizard so Vault is usable. Leaving Vault while onboarding is incomplete brings the wizard back and refreshes LLM / Exa status so badges are not stale.

Full Vault Connect cards stay in Vault (not embedded in the wizard). Vault hub IA and further connect migrations are tracked separately.

## Backend

- `GET /api/onboarding/status`: `{ completed, llmReady, llmStatus, cursorConnected }` for the active workspace
- `GET /api/onboarding/detect`: local models + Ollama probe (self-host; unused on Cloud UI path)
- ObjectType actions on `TenantOnboardingConfig`: `mark_llm_ready`, `complete`

Local single-user installs that previously stored flags in `platform_meta` are migrated once into the active tenant DB. **Hub mode never migrates** platform flags so every new workspace gets the wizard.

## Reset wizard for a workspace (ops)

Without deleting the account, clear tenant settings (SQL against that tenant DB):

```sql
DELETE FROM ai_settings WHERE key IN ('onboarding.completed', 'onboarding.llm_ready');
```

Then hard-refresh the app while signed into that workspace. If the tenant already stored a Vault Cursor key, remove or leave it: Vault keys still count as `llmReady` on hubs.

## Models directory

Place `.gguf` files in directories listed by `LLAMA_MODEL_DIRS` (semicolon-separated on Windows). Defaults include `~/llama.cpp/models` and `~/Downloads`.

For a tested Gemma 4 26B + 16 GB GPU profile, Docker hub + host `llama-server`, and `LLAMA_EXTERNAL` attach mode, see [LOCAL_LLM.md](./LOCAL_LLM.md).

## Optional Tailscale

After LLM setup, enable federation under **Shared → Network** if you plan to share across homes. See [SHARED_FEDERATION.md](./SHARED_FEDERATION.md).

Full walkthrough: [VERIFICATION.md](./VERIFICATION.md)

## The Graph (first land)

First land (Local + Cloud) opens **The Graph**: **You** ↔ Intelligence, with Chat bubbles left of the spine and **Hub** on the right fanning independently to **Support**, **Shared**, **Marketplace**, and **Workspaces**. Marketplace shows Official at full depth by default (Community / Local / Installed / Sell collapsed). Expand **Workspaces** for Personal (default full depth) / Project / Family. **Vault** holds secrets and Bank → Wallet. Structure, Knowledge, Automations, and Calendar fan directly off You and each agent. Click **You** for Information (Auth, Cloud, LLM keys) plus Kernel and Coding canvas tabs. Contacts, DMs, and Channels live in the Chat window. Unlock hubs are not on the map (see [SQLITE_UNIVERSE.md](./SQLITE_UNIVERSE.md)).

Nodes with open **missions** show an attention dot. Completing a mission awards connection-weighted points once; the global leaderboard lives on GodMode Cloud (see [GRAPH_MISSIONS.md](./GRAPH_MISSIONS.md)).

Click **You** to finish signup / open profile. Target storage is one SQLite file per actor/surface; until migrated, Bridge still uses legacy planes in [multi-tenant-model.md](./multi-tenant-model.md).

Route: `GET /api/graph/projection?focusType=architecture`.

### First-land journey (acceptance)

1. Land / open GodMode → The Graph (You → Intelligence spine).
2. Click Intelligence → Information; click Intelligence Chat bubble → Chat.
3. Expand Workspaces for Personal / Project Agents; explore Vaults and owner surfaces.
4. Click You → finish profile / signup.

## First-land Intelligence + trial inference (#758)

**Product decision:** Primary path is **GodMode Inference** (branded trial under our provisioned OpenRouter management / platform key; users pay through GodMode when free runs out). Personal OpenRouter OAuth or paste-key is advanced BYOK only. Do not land first-time users on a personal OpenRouter signup or OAuth flow.

On Local and Cloud app origins, first visit lands on The Graph. Opening Intelligence (and the Graph ether chat) seeds a genie-style greeting from `POST /api/trial-inference/ensure` (also stored in sessionStorage and broadcast as `godmode:trial-greeting`):

> Hey. We don't have many messages, so let's use them wisely, like a genie. This is GodMode Inference. After that, it's pay to play through GodMode.

When the GodMode user has a display name / email, the greeting personalizes (`Hey {firstName}` and `GodMode Inference for {email}`). OpenRouter username is never used in the greeting (mgmt-mint / platform shared path has no personal OpenRouter identity).

Background ensure flow:

1. Soft visitor cookie + hashed IP heuristics (not a fake login).
2. Prefer OpenRouter Management API mint when `OPENROUTER_MANAGEMENT_API_KEY` is set (authenticated users; Vault upsert + `llmReady`). **These keys live under our OpenRouter account** and back **GodMode Inference**, not the user's personal OpenRouter account.
3. Fall back to `TRIAL_PLATFORM_API_KEY` / `OPENROUTER_API_KEY` platform shared path.
4. Advanced BYOK only: best-effort personal OpenRouter signup deep-link (`personalSignupUrl`, default `https://openrouter.ai/sign-in` with `email` / `login_hint` query hints) and paste-key path (`pasteKeyPath` = Vault → Inference → OpenRouter). OpenRouter does **not** expose create-account, magic-link, or invite-by-email APIs.
5. Browser / computerUse / terminal provisioners are scaffolded in the order env only (not implemented here).

**Primary CTAs:** Continue chatting on GodMode Inference. When free allowance / rate limits run out, pay through GodMode (`payGodModePath`, placeholder `/vault?vault=cloud` until Inference billing ships; see `remainingOps`). Do not fake payment.

**Secondary / advanced CTAs:** `affiliateSignupUrl` (default `https://openrouter.ai/keys`) and `personalSignupUrl` for personal OpenRouter BYOK. Not in the genie greeting.

**Supply-side vision (scaffold only):** Marketplace already has listing kind `inference` (hub Bridge endpoints). Future: sellers list spare provider credits / capacity as GodMode Inference or as an Agent; GodMode routes trial/paid demand; settlement later. OpenRouter (or BYOK) remains the supply backend. See [MARKETPLACE.md](./MARKETPLACE.md#godmode-inference-supply-vision). Do not treat the Graph Sell → Inference stub as a working P2P marketplace.

Ops: set management and/or platform trial keys on Cloud (and Local when phoning home). Per-user mint still waits for sign-in unless `TRIAL_ALLOW_VISITOR_MINT=true`. Prompt-threshold convert, key revoke/expiry, and credentials-saved modal remain on issue #758.
