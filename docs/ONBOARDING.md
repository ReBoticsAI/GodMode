# Onboarding

Each **workspace (tenant)** runs the **FirstRunWizard** on first use until that workspace marks an LLM as ready (or you choose the cloud/Vault path). Completing onboarding for one account does **not** dismiss it for others. That matters for multi-user hubs.

![Home after onboarding](assets/readme/hero-home.png)

## When the wizard shows

The web client calls `GET /api/onboarding/status` after the user is authenticated and past SaaS gates (email verified; platform admins also need MFA). The wizard opens when both `completed` and `llmReady` are false for the **active tenant**.

On SaaS, unverified users cannot call product APIs (`403 EMAIL_NOT_VERIFIED`). The client waits until email verification succeeds, then re-checks status. A hard refresh after verify also re-runs the gate.

Flags live in the tenant SQLite `ai_settings` table (`onboarding.completed`, `onboarding.llm_ready`). Browser `localStorage` is updated when the wizard finishes but is **not** the source of truth for showing it.

On multi-tenant hubs, a process-wide `CURSOR_API_KEY` does **not** mark every workspace `llmReady`. Only a tenant Vault Cursor key (or an explicit `onboarding.llm_ready` flag) does.

## Steps

### Self-host / desktop / private hub

1. **Welcome**: overview of Intelligence and workspace areas.
2. **LLM**: pick a local GGUF model, detect Ollama, or skip and add cloud keys in Vault later.
3. **Ready**: open Chat and browse Marketplace starter packs anytime.

### GodMode Cloud (`INSTALLATION_SURFACE=saas`)

1. **Welcome**: same overview.
2. **Connect your LLM**: Vault BYOK (Cursor subscription and/or OpenAI / Anthropic). No GGUF or Ollama steps.
3. **Ready**: open Chat; manage keys anytime in Vault (Inference for LLM keys; Search for Exa web tools).

Richer guided Vault collection (validate keys in-wizard) is tracked in GitHub issue #224.

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
