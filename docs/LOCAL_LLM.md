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

Compose example: [deploy/docker-compose.hub-external-llm.yml](../deploy/docker-compose.hub-external-llm.yml).

With `LLAMA_EXTERNAL=true`, Bridge **attaches** to the host server (does not spawn or kill it). Stopping the model in the UI only detaches.

## Onboarding

See [ONBOARDING.md](./ONBOARDING.md). Each workspace must complete the LLM step; hub tenants do not share that flag.
