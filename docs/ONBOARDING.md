# Onboarding

First sign-in runs the **FirstRunWizard** until an LLM is ready or you choose cloud API keys.

![Home after onboarding](assets/readme/hero-home.png)

## Steps

1. **Welcome** — overview of Intelligence and workspace areas.
2. **LLM** — pick a local GGUF model, detect Ollama, or skip and add cloud keys in Vault later.
3. **Ready** — open Chat and browse Marketplace starter packs anytime.

## Backend

- `GET /api/onboarding/status` — `{ completed, llmReady, llmStatus }`
- `GET /api/onboarding/detect` — local models + Ollama probe
- `POST /api/onboarding/llm/local` — start llama-server with selected model
- `POST /api/onboarding/llm/cloud-ready` — mark cloud path (Vault keys)
- `POST /api/onboarding/complete` — dismiss wizard

## Models directory

Place `.gguf` files in directories listed by `LLAMA_MODEL_DIRS` (semicolon-separated on Windows). Defaults include `~/llama.cpp/models` and `~/Downloads`.

## Optional Tailscale

After LLM setup, enable federation under **Shared → Network** if you plan to share across homes. See [SHARED_FEDERATION.md](./SHARED_FEDERATION.md).

Full walkthrough: [VERIFICATION.md](./VERIFICATION.md)
