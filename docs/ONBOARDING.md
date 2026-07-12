# Onboarding

Each **workspace (tenant)** runs the **FirstRunWizard** on first use until that workspace marks an LLM as ready (or you choose the cloud/Vault path). Completing onboarding for one account does **not** dismiss it for others — important for multi-user hubs.

![Home after onboarding](assets/readme/hero-home.png)

## Steps

1. **Welcome** — overview of Intelligence and workspace areas.
2. **LLM** — pick a local GGUF model, detect Ollama, or skip and add cloud keys in Vault later.
3. **Ready** — open Chat and browse Marketplace starter packs anytime.

## Backend

Onboarding flags live in the **tenant** SQLite `ai_settings` table (`onboarding.completed`, `onboarding.llm_ready`), not platform-wide meta.

- `GET /api/onboarding/status` — `{ completed, llmReady, llmStatus }` for the active workspace
- `GET /api/onboarding/detect` — local models + Ollama probe
- `POST /api/onboarding/llm/local` — start llama-server with selected model (marks this workspace ready)
- `POST /api/onboarding/llm/cloud-ready` — mark cloud path for this workspace (Vault keys)
- `POST /api/onboarding/complete` — dismiss wizard for this workspace

Local single-user installs that previously stored flags in `platform_meta` are migrated once into the active tenant DB. **Hub mode never migrates** platform flags so every new workspace gets the wizard.

## Models directory

Place `.gguf` files in directories listed by `LLAMA_MODEL_DIRS` (semicolon-separated on Windows). Defaults include `~/llama.cpp/models` and `~/Downloads`.

## Optional Tailscale

After LLM setup, enable federation under **Shared → Network** if you plan to share across homes. See [SHARED_FEDERATION.md](./SHARED_FEDERATION.md).

Full walkthrough: [VERIFICATION.md](./VERIFICATION.md)
