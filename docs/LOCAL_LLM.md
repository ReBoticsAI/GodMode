# Local LLM (llama.cpp)

GodMode can run Intelligence against a local **GGUF** via [llama.cpp](https://github.com/ggml-org/llama.cpp) `llama-server`, or attach to a server you already run on the host (typical for Docker hubs).

## Recommended reference profile

This is a community-tested starting point for a **single ~16 GB NVIDIA GPU** home server. Adjust MoE offload and context if your VRAM differs.

| Item | Recommendation |
|------|----------------|
| **GPU** | NVIDIA RTX class with **16 GB** VRAM (e.g. RTX 5060 Ti 16 GB) |
| **System RAM** | **32 GB+** when using MoE CPU offload |
| **Model** | **Gemma 4 26B Instruct Q4** GGUF (`gemma-4-26B*_q4_0*.gguf` or equivalent Q4) |
| **Model context** | Architectural max **256K** tokens for Gemma 4 26B A4B |

### llama-server flags

```bash
llama-server \
  -m /path/to/gemma-4-26B_q4_0-it.gguf \
  -ngl 99 \
  -c 262144 \
  -t 3 \
  -b 2048 \
  -ub 512 \
  -fa on \
  --jinja \
  --n-cpu-moe 14 \
  --host 0.0.0.0 \
  --port 8081
```

| Flag | Why |
|------|-----|
| `-ngl 99` | Full GPU layer offload |
| `-c 262144` | Full 256K context window |
| `-t 3` | Leave CPU headroom for other processes / agent work |
| `--n-cpu-moe 14` | Keep enough MoE experts on CPU so 256K KV fits in 16 GB VRAM with ~1+ GB free |
| `-fa on` / `--jinja` | Flash attention + chat templates |

**Speed vs headroom (same card, 256K ctx):** more `--n-cpu-moe` → slower but more free VRAM; less → faster but tighter. Around **14** is a good balance (~28 tok/s class on the reference GPU). Around **21** lands nearer ~20 tok/s with more spare VRAM. Below ~12 often OOMs at 256K on 16 GB.

Place the GGUF where GodMode can see it (`LLAMA_MODEL_DIRS`), or only on the host if you use external attach (below).

## Native install (Bridge spawns llama-server)

1. Build or install `llama-server` and set `LLAMA_SERVER_BIN`.
2. Put `.gguf` files under dirs listed in `LLAMA_MODEL_DIRS` (semicolon-separated on Windows).
3. First-run wizard → pick the model → **Start local model**.

Defaults and tuning: [CONFIGURATION.md](./CONFIGURATION.md).

## Docker hub + host llama-server

The Alpine GodMode image does **not** run CUDA inference. Run `llama-server` on the **host** (systemd, script, etc.), mount a models directory for discovery, and set:

| Variable | Example |
|----------|---------|
| `LLAMA_EXTERNAL` | `true` |
| `LLAMA_MODEL_DIRS` | `/models` |
| `LLAMA_SERVER_HOST` | `host.docker.internal` |
| `LLAMA_SERVER_PORT` | `8081` |
| `LLAMA_TOOL_MODE` | `native` (required for Gemma with host `--jinja`; grammar can loop on tools like `list_subagents`) |

Compose example: [deploy/docker-compose.hub-external-llm.yml](../deploy/docker-compose.hub-external-llm.yml).

Host `llama-server` must use **`--jinja`** so chat/tool templates match. With `LLAMA_EXTERNAL=true`, Bridge defaults `LLAMA_TOOL_MODE` to **native** if unset.

## Model harness profiles (picker-driven)

Changing the model in the Intelligence picker does more than swap backends: Bridge resolves a **`ModelHarnessProfile`** and applies it on the next chat turn. Profiles encode NVIDIA-style harness engineering (tool mode, sampling, prompt delta, discovery-tool middleware) per model family — not one global Cursor-parity loop for every LLM.

Registry: [`apps/bridge/src/services/model-profiles/`](../apps/bridge/src/services/model-profiles/index.ts).

| Profile | When | Highlights |
|---------|------|------------|
| **`gemma-4`** | Local GGUF path/name matches `/gemma-4/i` | `toolMode: native`, sampling `1.0 / 0.95 / 64`, max 12 tool iterations, defer `list_subagents` unless agent context, strip thought channels from history |
| **`cursor`** | Picker `source: cursor` | Stub: native tools, no grammar |
| **`openai` / `anthropic`** | Picker `source: provider` | Stub: provider-native tools |
| **`generic-local`** | Other local GGUFs | Conservative discovery deferral + simple-chat delta |
| **`remote`** | Shared marketplace model | Stub |

Flow: picker → `POST /ai/select-model` → `resolveHarnessProfile` → store `config.harnessProfileId` (display) → each `/ai/chat` **re-derives** from the active model so the harness cannot drift.

### Gemma 4 card → profile

| HF / Google card | Profile setting |
|------------------|-----------------|
| Native function calling + jinja | `toolMode: "native"` (never grammar for this family) |
| `temperature=1.0`, `top_p=0.95`, `top_k=64` | Sampling overlay on chat |
| Thinking via `<\|think\|>` / channel thoughts | Default thinking off; strip channels before multi-turn history |
| Agentic but loops on discovery tools | Harness delta: no tools for greetings; defer `list_subagents` unless the user asks about agents |
| Long tool loops | `maxChatIterations: 12` (+ existing identical-call breaker) |

Adding a new model later = add/fill a profile entry; picker wiring stays the same. Profiles are **not** plugins — see [PLUGIN_AUTHORING.md](./PLUGIN_AUTHORING.md).

## Onboarding

See [ONBOARDING.md](./ONBOARDING.md). Each workspace must complete the LLM step; hub tenants do not share that flag.
