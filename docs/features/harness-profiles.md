---
slug: harness-profiles
title: "Harness profiles"
section: "Intelligence"
summary: "Transport-aware model harness matrix (backend × provider × family)."
---
# Harness profiles

GodMode tunes the **system around the model** (prompts, tool mode, sampling, deferred tools), not the weights. Same idea as [NVIDIA + LangChain harness engineering](https://blogs.nvidia.com/blog/nemotron-langchain-agents-open-stack/).

Resolution: `profile = f(backend, provider?, modelFamily?)`. Model id alone is never enough. Cursor Claude and Anthropic API Claude must not share a profile.

## Matrix (growing)

| Backend | Provider | Family hint | Profile id |
|---------|----------|-------------|------------|
| local | — | Gemma 4 GGUF | `gemma-4` |
| local | — | other | `generic-local` |
| cursor / cursor_cloud | — | auto | `cursor-auto` |
| cursor / cursor_cloud | — | composer* | `cursor-composer` |
| cursor / cursor_cloud | — | grok* | `cursor-grok` |
| cursor / cursor_cloud | — | other | `cursor` |
| provider | openai | * | `openai` |
| provider | anthropic | * | `anthropic` |
| provider | openai_compatible (OpenRouter) | `deepseek/*` | `openrouter-deepseek` |
| provider | openai_compatible (OpenRouter) | `z-ai/*` | `openrouter-glm` |
| provider | openai_compatible (OpenRouter) | `nvidia/nemotron*` | `openrouter-nemotron` |
| provider | openai_compatible (OpenRouter) | `minimax/*` | `openrouter-minimax` |
| provider | openai_compatible (OpenRouter) | `moonshotai/*` | `openrouter-kimi` |
| provider | openai_compatible (OpenRouter) | other (MiMo, Hy3, Step, Ling, …) | `openrouter-generic` |
| provider | openai_compatible (Groq) | `llama-*` / `meta-llama/llama-*` | `groq-llama` |
| provider | openai_compatible (Groq) | `openai/gpt-oss*` | `groq-gpt-oss` |
| provider | openai_compatible (Groq) | `qwen/*` | `groq-qwen` |
| provider | openai_compatible (Groq) | `moonshotai/*` | `groq-kimi` |
| provider | openai_compatible (Groq) | `groq/compound*` | `groq-compound` |
| provider | openai_compatible (Groq) | other | `groq-generic` |
| provider | openai_compatible (Together) | `meta-llama/*` | `together-llama` |
| provider | openai_compatible (Together) | `openai/gpt-oss*` | `together-gpt-oss` |
| provider | openai_compatible (Together) | `deepseek-ai/*` | `together-deepseek` |
| provider | openai_compatible (Together) | `qwen/*` | `together-qwen` |
| provider | openai_compatible (Together) | `moonshotai/*` | `together-kimi` |
| provider | openai_compatible (Together) | `minimaxai/*` | `together-minimax` |
| provider | openai_compatible (Together) | `zai-org/*` | `together-glm` |
| provider | openai_compatible (Together) | `nvidia/nemotron*` | `together-nemotron` |
| provider | openai_compatible (Together) | `google/gemma*` | `together-gemma` |
| provider | openai_compatible (Together) | other | `together-generic` |
| provider | openai_compatible (Fireworks) | `*llama*` | `fireworks-llama` |
| provider | openai_compatible (Fireworks) | `*gpt-oss*` | `fireworks-gpt-oss` |
| provider | openai_compatible (Fireworks) | `*deepseek*` | `fireworks-deepseek` |
| provider | openai_compatible (Fireworks) | `*qwen*` | `fireworks-qwen` |
| provider | openai_compatible (Fireworks) | `*kimi*` | `fireworks-kimi` |
| provider | openai_compatible (Fireworks) | `*minimax*` | `fireworks-minimax` |
| provider | openai_compatible (Fireworks) | `*glm*` | `fireworks-glm` |
| provider | openai_compatible (Fireworks) | `*nemotron*` | `fireworks-nemotron` |
| provider | openai_compatible (Fireworks) | `*gemma*` | `fireworks-gemma` |
| provider | openai_compatible (Fireworks) | other | `fireworks-generic` |
| provider | openai_compatible (DeepSeek) | `deepseek-v4-flash` | `deepseek-flash` |
| provider | openai_compatible (DeepSeek) | `deepseek-v4-pro` | `deepseek-pro` |
| provider | openai_compatible (DeepSeek) | other | `deepseek-generic` |
| remote | — | * | `remote` |

OpenRouter is a **transport**. Profile = `f(openrouter transport, modelFamily)` from the slug prefix. Direct OpenAI/Anthropic Console profiles stay distinct from OpenRouter-routed models. Catalog top-10 on the Vault card is pinned to a 2026-08-03 usage snapshot; custom slugs are allowed.

Groq is also a **transport**. Profile = `f(groq transport, modelFamily)`. GPT-OSS on Groq uses `groq-gpt-oss`, not the OpenAI Platform `openai` profile. Production chat catalog snapshot 2026-08-03; custom model ids allowed.

Together is also a **transport**. Profile = `f(together transport, modelFamily)`. Distinct from Groq/OpenRouter and from local `gemma-4`. Serverless chat catalog snapshot 2026-08-03; custom model ids allowed.

Fireworks is also a **transport**. Profile = `f(fireworks transport, modelFamily)` from the model slug leaf under `accounts/fireworks/models/`. Distinct from Together/Groq/OpenRouter for the same weights. Serverless chat catalog snapshot 2026-08-03; custom model ids allowed.

DeepSeek Platform is also a **transport**. Profile = `f(deepseek transport, modelFamily)`. Distinct from Fireworks/Together/OpenRouter DeepSeek routes. Catalog uses V4 ids (`deepseek-v4-flash`, `deepseek-v4-pro`); custom model ids allowed.

Source of truth: `apps/bridge/src/services/model-profiles/index.ts`. Vault Connect cards must land or update a row when a provider ships (Part of #232 / epic #321).
