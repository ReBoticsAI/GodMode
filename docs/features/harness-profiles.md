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
| remote | — | * | `remote` |

OpenRouter is a **transport**. Profile = `f(openrouter transport, modelFamily)` from the slug prefix. Direct OpenAI/Anthropic Console profiles stay distinct from OpenRouter-routed models. Catalog top-10 on the Vault card is pinned to a 2026-08-03 usage snapshot; custom slugs are allowed.

Source of truth: `apps/bridge/src/services/model-profiles/index.ts`. Vault Connect cards must land or update a row when a provider ships (Part of #232 / epic #321).
