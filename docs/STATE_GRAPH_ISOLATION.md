# State of play: Graph + isolation

**As of 2026-09-11 (branch `wip/graph-workspaces-agents`, draft PR [#788](https://github.com/ReBoticsAI/GodMode/pull/788)).**

Use this when chat context is gone. Prefer this over assuming “Graph nodes = SQLite files = VMs.”

## Three layers (do not conflate)

| Layer | What it is | Status |
|-------|------------|--------|
| **Graph** | R3F map of You / Hub / Intelligence / Workspaces / Agents / Vaults / Chat (Structure, Knowledge, Automations, Calendar fan off You and agents) | Live on WIP; SVG glyphs in DOM `Html` overlays; edges are Lines |
| **SQLite universe + Data Router** | Storage execution | Mostly **target** + pilots; #778 digests chat **reads** only |
| **Per-user box + job throwaway** | Compute isolation | **Not built** (#780, #781) |

## Shipped on `main`

- **#778** Data Router Phase 1: `ChatSession` / `ChatMessage` list/get → JSON digests (`DATA_ROUTER_CHAT_READS`, default on). SoR still workspace SQLite. Shared Bridge process.
- **#786** Windows `concurrently -r` + blank `PLATFORM_*` env paths.
- **#787** `scripts/ensure-native-addons.mjs` / `rebuild:natives` for `ignore-scripts` installs.
- **#172** Conditional GO for #780 (strong container interim OK). Closed.

## On Graph WIP / PR #788

- First-land Graph canvas, architecture catalog, missions, sqlite-universe registry pilots.
- Product rename: **Heart → Hub** (UI/docs/missions); on-disk path still `heart/`; node id still `hub:heart`.
- Graph copy: **You**; objectType/API remains `User`.
- Docs: Graph-first section in [DATA_ISOLATION.md](./DATA_ISOLATION.md); [ROADMAP_GRAPH_ISOLATION.md](./ROADMAP_GRAPH_ISOLATION.md); this file.
- Dual-write **empty** shells: `chats/<id>.sqlite`, some agent/you/vault/surface pilots. **Not** product SoR.

## Not true (common false assumptions)

- Graph nodes each have their own live SQLite SoR.
- Customers are already in per-user containers / microVMs.
- Data Router mounts separate shard workers (still in-process digests).
- Hub file `heart/bridge.sqlite` holds real Bridge ops SoR (shell only).
- Signed-in local/Cloud chat digest UI smoke is done (still needs credentials).

## Open ladder (order unchanged)

1. Land / review Graph PR #788; signed-in smoke (local ± Cloud pin).
2. **#779** chat-first shard (promote dual-write → SoR; Router mounts).
3. Parallel prefer: **#591** cgroups.
4. **#780** disposable job throwaway.
5. **#781** per-user runtime box (wraps Graph instance).
6. **#782** dedicated VPS SKU last.

## Local ports

- Web: http://127.0.0.1:5173 (pre-auth Graph on this branch)
- Bridge: http://127.0.0.1:3847/api/health
- Auth wall: `?auth=1`

## Related

- Epic [#777](https://github.com/ReBoticsAI/GodMode/issues/777)
- [DATA_ISOLATION.md](./DATA_ISOLATION.md)
- [SQLITE_UNIVERSE.md](./SQLITE_UNIVERSE.md)
- [ROADMAP_GRAPH_ISOLATION.md](./ROADMAP_GRAPH_ISOLATION.md)
- [GRAPH_CHROME.md](./GRAPH_CHROME.md) (Information `focusOwner` ownership rule)
