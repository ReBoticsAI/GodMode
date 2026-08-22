# Hostinger SaaS pin notes (embeddings)

GodMode Cloud production uses `deploy/docker-compose.prod.yml` plus Hostinger `.env.production`.

## Embeddings (shared host RAG)

Bridge attaches to a **host** embedder; it does not spawn EmbeddingGemma inside the SaaS container when `EMBEDDINGS_EXTERNAL=true`.

1. Run `llama-server` on the VPS with `--embeddings --pooling mean` on port **8082** (EmbeddingGemma or successor; model path on the host).
2. Set in `.env.production` (see `deploy/.env.production.example`):
   - `EMBEDDINGS_ENABLED=true`
   - `EMBEDDINGS_EXTERNAL=true`
   - `EMBEDDINGS_SERVER_HOST=host.docker.internal`
   - `EMBEDDINGS_PORT=8082`
   - `EMBEDDINGS_QUEUE_ENABLED=true`
3. Recreate / pin so Bridge picks up env (`docker compose` up with the prod file).
4. Verify as an authenticated user: `GET /api/ai/embeddings/status` → `enabled: true`, embedder `healthOk: true`.
5. Rebuild capability index if workflows/skills are missing from chat Capabilities (Admin or Intelligence tool).

### Who can Enable / Start / Stop

| Surface | Controls |
| --- | --- |
| GodMode Cloud / hub | Platform **Admin → Embeddings** only |
| GodMode Local | Each user’s Intelligence Memory / Activity |

Tenant workspace Memory UI on hub/SaaS is read-only for the engine switch.

## Chat LLM vs embeddings

GodMode Cloud chat is **Vault BYOK only** (no hosted seat chat GGUF). The shared host model process is the **embeddings** engine (fair queue), not a multi-tenant chat llama-server.

Tenant owners must not start/stop/restart a host chat LLM, enqueue host LoRA training, or change process launch flags on hub/SaaS. Those stay platform Admin (private hub) or Local-only. See #638.
