# Agent memory architecture

GodMode Intelligence memory maps to the classic four-layer model without external connectors (no Gmail/Notion in v1).

| Layer | GodMode store | How it moves |
|-------|---------------|--------------|
| **Working** | Chat history (`ai_messages`) + char compaction | Compaction may drop early turns; when it does, episodic distill is enqueued |
| **Semantic** | `ai_memories` (global / chat) + hybrid RAG | Every write calls `indexMemory` (FTS + optional embed); chat injects a memory section |
| **Episodic** | Distilled episode memories (`category=episode`, `source=distill`) | Debounced job after `chat_completed` (~45s); default pending approval |
| **Procedural** | Skills + rules + capability RAG | `create_skill` gated for playbook structure + near-duplicate rejection |
| **Wiki (durable)** | `wiki_pages` + hybrid wiki RAG | Chat injects wiki snippets; synthesize job proposes `knowledge/` / `decisions/` patches |

## Write path

1. `remember` tool / REST create-update-approve / reflection `create_memory` / distill → `indexMemory(db, embedder, id, text)`.
2. Deletes remove the FTS row via `removeMemoryFromIndex`.
3. Hybrid retrieval (`getHybridMemoriesText`) filters `valid_from` / `valid_until` and joins BM25 to agent/scope/status.

## Embeddings on hub

Same pattern as the chat LLM: attach to a **host** embedder — do not ship CUDA into Alpine.

| Variable | Example |
|----------|---------|
| `EMBEDDINGS_ENABLED` | `true` |
| `EMBEDDINGS_EXTERNAL` | `true` |
| `EMBEDDINGS_SERVER_HOST` | `host.docker.internal` |
| `EMBEDDINGS_PORT` | `8082` |
| `EMBEDDINGS_MODEL_PATH` | host path to EmbeddingGemma GGUF (spawn only when not external) |

Backfill walks **tenant workspace DBs**, not only the operator bootstrap DB. Wiki FTS is on core; page embeds update when the embedder is ready.

Compose example: [deploy/docker-compose.hub-external-llm.yml](../deploy/docker-compose.hub-external-llm.yml). Host unit notes: [LOCAL_LLM.md](./LOCAL_LLM.md).

## Chat prompt sections

Enabled by default in the prompt flow:

- **memory** — hybrid top-K memories  
- **wiki** — hybrid top-K snippets with `[slug]` citations  
- **capabilities** — tool/skill RAG  

Gemma 4 harness: treat memory/wiki as already retrieved; defer `remember` on greetings; wiki tools only when docs are clearly needed.

## Jobs

| Job | Trigger | Output |
|-----|---------|--------|
| Episodic distill | `chat_completed` debounce / compaction drops / `POST /ai/memory/distill` | Pending/active episode memories |
| Wiki synthesize | Nightly cron / `POST /ai/memory/wiki-synthesize` | `wiki_page_proposals` for human approve |
| Reflection | Existing idle/cron | Rules/skills/memories (skills must be playbooks) |

Approve episodes in **Intelligence → Memory**. Approve wiki proposals under **Wiki → Proposals**.

## Out of scope (this architecture)

OpenWiki CLI, Gmail/Notion connectors, ANN vector DB, Computer Use.
