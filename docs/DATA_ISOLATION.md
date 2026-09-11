# Data and compute isolation ladder

Design note for [#777](https://github.com/ReBoticsAI/GodMode/issues/777): the
full shared-Cloud isolation stack beyond today's coding Layers 1–4.

**Related:** [SECURITY.md](SECURITY.md) (coding posture), [multi-tenant-model.md](multi-tenant-model.md)
(storage planes), [PLUGIN_ISOLATION.md](PLUGIN_ISOLATION.md) (Community child
process), [#172](https://github.com/ReBoticsAI/GodMode/issues/172) (job microVM
slice), [#591](https://github.com/ReBoticsAI/GodMode/issues/591) (cgroups),
[#736](https://github.com/ReBoticsAI/GodMode/issues/736) (queue workers /
per-tenant runners).

## Goal

Compose data and compute isolation so GodMode Cloud on a shared Ubuntu VPS can
honestly harden customer blast radius without claiming bank-grade or
dedicated-hardware isolation:

1. **SQLite shards** — durable state blast radius (file = trust boundary).
2. **Data Router** — only storage door under the ObjectType kernel; digests for
   consumers (UI, agents, LLMs).
3. **Per-user runtime box + disposable job throwaway** — execution blast radius
   so customers can run agents, plugins, and network **inside their box**, but
   cannot modify the VPS or sibling users.

Product default: **shared VPS fleet** with a **per-user runtime box** as the
Cloud isolation unit. A whole dedicated VPS per customer is a later billing SKU
(Phase 5), not the baseline Cloud claim.

## What this is not

- Not PCI / SOC2 / bank-grade marketing while hosts are shared.
- Not a mandate to rewrite `@godmode/kernel` in Rust or replace `apps/web`.
- Not a second product API beside the kernel. The Router is storage execution
  under kernel policy.
- Not plugin runtime isolation (see [PLUGIN_ISOLATION.md](PLUGIN_ISOLATION.md)).
- Not remote HTTP/SSE MCP trust (outbound URL trust; tracked separately).
- Not “one VPS per signup” as the default (that is Phase 5).

## Deploy tree (Cloud target)

```text
Ubuntu VPS (operator machine; customers never administer this)
  GodMode Cloud
    # platform: auth, billing, Marketplace, Cloud/Users DBs, orchestrator
  host sidekicks
    # nginx/TLS, job/build supervisor, backups (never inside user boxes)
  per-user runtime box
    # Cloud default isolation unit (strong container; microVM-class preferred
    # as the hard boundary when ops allow)
    workspaces + agents
      # live inside the user box; not a separate box per agent by default
    one disposable job throwaway
      # single box for a toolful chat/coding/browser burst; then gone
  Data Router + shards
    # mount only that user's granted files; digests to consumers
```

**Rules of the box**

- Users may run agents, plugins, and talk to the internet **inside** their box.
- Users must not build into or reconfigure the Ubuntu host or sibling boxes.
- Prefer **one** throwaway job per burst (avoid nested bloat).
- Platform admin is the same shape as any user with more grants, not a parent of
  every customer box.
- Host sidekicks keep `docker.sock` / privileged supervisors off user mounts.

## Today vs target

| Concern | Today | Target |
|---------|--------|--------|
| Compute home | One shared Bridge container for all tenants | GodMode Cloud + **per-user runtime box** on the same VPS |
| Host / account / workspace data | `Cloud.sqlite`, `Users.sqlite`, `users/<id>.sqlite`, `tenants/<id>.sqlite` | Keep planes; Cloud/Users stay on platform; user/workspace shards mount into the user box as granted |
| Plugin business data | `plugin-data/{tenant}/{plugin}.sqlite` | Keep; mount only into the owning user box |
| Chat / agent / page rows | Tables inside workspace SQLite | Split to own files when mount and lifecycle need it |
| Who opens SQLite | Bridge process (`getTenantDb`, adapters) | Data Router workers mount only granted shards |
| What LLMs see | In-process tool results / broad service reads | Report digests; no live DB handles |
| Untrusted coding / tools | Layers 1–4 on shared host (#112); residual #172 | One disposable job throwaway under the user box (microVM-class preferred) |
| Noisy neighbor | Concurrency caps (#96); cgroups planned (#591) | Hard limits on user boxes and job throwaways |
| Dedicated machine | N/A | Phase 5 whole-VPS SKU |

Today’s one Bridge is the **strangle baseline**, not the forever Cloud home.

## Architecture

### Platform vs user instance

| Piece | Role |
|-------|------|
| **GodMode Cloud** | Shared control plane: identity, billing, Marketplace, `Cloud.sqlite` / `Users.sqlite`, orchestrator that places user boxes and jobs |
| **Per-user runtime box** | That customer’s GodMode instance home: workspaces, agents, plugins, ObjectType graph |
| **Disposable job** | Short-lived compute for toolful work; artifact handoff only |
| **Data Router** | Storage execution under kernel policy |

### Data path

```text
Consumer (Web, agent, LLM)
  -> Auth + tenant resolve (GodMode Cloud)
  -> ObjectType kernel (policy: may you?)
  -> Data Router (which shards, how)
       -> Query / write workers (SoR; mount only granted shards)
       -> Report workers (digest schema for that consumer; no SQLite)
  -> Optional digest cache (projection; rebuild from shards)
  -> Digest to consumer
```

### Kernel vs Data Router

| Piece | Owns |
|-------|------|
| **Kernel** | Authentication-derived `OperationContext`, ObjectType registry, access and action policy, adapter contracts, idempotency, durable operation runs |
| **Data Router** | Shard resolution, worker spawn and kill, mount allowlists, digest schemas, cache invalidation hooks |

Adapters and services keep business rules. Over time they call the Router instead
of opening workspace files directly (`getTenantDb` strangler).

### Shard grain (progressive)

Do not file-split every ObjectType on day one. Split when a lifecycle or mount
boundary is real:

| Shard | Status |
|-------|--------|
| Cloud / Users | Platform (GodMode Cloud); not mounted into arbitrary user jobs |
| User / Workspace | Already files; keep; primary mounts for the user box |
| Plugin (`plugin-data/...`) | Already files; keep |
| Chat | Candidate first object shard (disposable job mount) |
| Agent | Split only if agent memory/runtime needs a private mount; agents otherwise inherit the user box |
| Page / wiki unit | Split only when editor or export workers need isolation |

Workspace SQLite remains the registry and join hub until a shard is extracted.
Cross-cutting search and dashboards use Router aggregations / caches, not
ad-hoc multi-file SQL from a shared Bridge.

### Worker kinds

| Kind | May open SQLite? | Role |
|------|------------------|------|
| **SoR query / write** | Yes, granted shards only | Short-lived; least-privilege mount; then exit |
| **Report** | No | Turns query results into consumer digests (LLM tool JSON, UI lists, exports) |
| **Disposable job** (coding, terminal, stdio MCP, browser/computer) | Only via explicit artifact or Router-mediated mounts | One throwaway per burst; microVM-class preferred; see #172 |

Caches and read models are disposable. Shards remain source of truth.

### Compute ladder

| Layer | Default | Notes |
|-------|---------|--------|
| Ubuntu VPS | Shared fleet | Operator-owned |
| GodMode Cloud + sidekicks | Shared | Never give customers host privileges |
| Per-user runtime box | **Cloud default** | Strong container; microVM-class preferred as hard boundary when ops allow |
| Workspaces + agents | Inside user box | No per-agent box by default |
| One disposable job | Per toolful burst | Avoid nested workspace/agent boxes for small work |
| Whole dedicated VPS | Phase 5 SKU | Strongest practical isolation; different product |

Layers 1–4 remain the production-minded baseline on today’s shared Bridge until
Phases 3–4 ship. Cgroups (#591) are the incremental noisy-neighbor slice without
waiting on microVMs. #736 queue sharding remains related for worker density
inside or beside per-user boxes.

## Threat model

| Residual today | Shards | Router | Per-user box | Job throwaway |
|----------------|--------|--------|--------------|---------------|
| One Bridge process for all tenants | No | No | Yes (primary) | Defense in depth |
| One workspace DB holds many concerns | Shrinks when chat/agent/page split | Chooses which files open | Mounts only that user’s files | Narrower mount for the burst |
| Consumer holds broad in-process DB access | Helps if workers mount narrowly | Digests only | Limits which process sees mounts | Same |
| Escape into Ubuntu host / sibling users | No | No | Softens (container) / strengthens (microVM) | Same class as box technology |
| CPU / memory / fork bombs | No | No | Yes with hard limits | Yes with hard limits (#591 without VMs) |
| Remote HTTP/SSE MCP | No | No | No | No |
| Hostile sibling on same metal | Softened | Softened | Softened | Softened; Phase 5 for hard separation |

Honest ceiling: still one physical VPS under everyone until Phase 5.

## Phased roadmap

| Phase | Focus | Outcome | Tracking |
|-------|--------|---------|----------|
| **0** | Epic + this note + child issues | Written go path | #777 |
| **1** | Data Router facade under kernel (in-process strangler) | Agent/chat reads can return digests; still workspace SQLite | #778 |
| **2** | First object shard (chat or agent) + Router path | File isolation for that lifecycle | #779 |
| **3** | One disposable job throwaway per burst | #172 direction; microVM-class preferred; #591 cgroups incremental | #780 (design: #172) |
| **4** | **Per-user runtime box as Cloud default** | Customer instance home on shared VPS; agents inherit the box | #781 (related: #736) |
| **5** | Dedicated whole-VPS SKU | Billing product; not shared Cloud claim | #782 |

Migration style: **strangler**. Keep auth, Marketplace, plugins, and the shadcn
Control Center. Do not ground-up rewrite the product to ship this ladder.

## Non-goals

- Claiming Cursor-Cloud-equivalent or bank-grade isolation on a shared VPS
- Per-plugin Firecracker before job throwaways prove ops cost
  ([PLUGIN_ISOLATION.md](PLUGIN_ISOLATION.md))
- Raising `MAX_OPEN` or poll-all tenant DBs as a substitute for Router + boxes
- Making dedicated hardware the default Cloud offer in Phase 0–4
- Per-workspace or per-agent boxes as the default (only if load or threat later needs them)

## References

- Epic: [#777](https://github.com/ReBoticsAI/GodMode/issues/777)
- Coding jail: [#112](https://github.com/ReBoticsAI/GodMode/issues/112), [SECURITY.md](SECURITY.md)
- Job microVM design: [#172](https://github.com/ReBoticsAI/GodMode/issues/172)
- Cgroups: [#591](https://github.com/ReBoticsAI/GodMode/issues/591)
- Queue workers: [#736](https://github.com/ReBoticsAI/GodMode/issues/736)
- Cloud isolation epic parent: [#396](https://github.com/ReBoticsAI/GodMode/issues/396)
- Plugin runtime: [PLUGIN_ISOLATION.md](PLUGIN_ISOLATION.md), [#559](https://github.com/ReBoticsAI/GodMode/issues/559)
- Storage planes: [multi-tenant-model.md](multi-tenant-model.md)
