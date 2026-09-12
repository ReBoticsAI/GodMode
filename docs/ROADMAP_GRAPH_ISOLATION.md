# Local roadmap: Graph-first isolation

Working order for Graph WIP and the Cloud isolation ladder. Epic
[#777](https://github.com/ReBoticsAI/GodMode/issues/777) stays the public spine.
This file is the near-term sequence; it does not replace the GitHub Project board.

## Where we are

| Item | Status |
|------|--------|
| Data Router Phase 1 (#778) | Shipped on `main` |
| Windows `npm run dev` (#786), native ensure (#787) | On `main` |
| Graph WIP `wip/graph-workspaces-agents` | Local + remote; pre-auth Graph at `:5173` |
| Heart → Hub / You copy + DATA_ISOLATION Graph section | On this branch |
| #172 design GO for #780 | Closed |
| Cloud/local signed-in chat digest smoke | Still needs a signed-in session |
| #779–#782, #591 | Open; no phase reorder |

```mermaid
flowchart LR
  done778[Done_778_Router]
  graphLand[Land_Graph_WIP]
  smoke[Signed_in_smoke]
  shard779[779_chat_shard]
  cgroup591[591_cgroups]
  job780[780_throwaway]
  box781[781_user_box]
  vps782[782_SKU_later]
  done778 --> graphLand --> smoke --> shard779
  smoke --> cgroup591
  shard779 --> job780 --> box781 --> vps782
  cgroup591 --> job780
```

## Working order

### Now (this branch)

1. **Commit + push** Hub/You renames and DATA_ISOLATION Graph section.
2. **Finish Graph WIP to a reviewable PR** (merge only when ready): polish blockers, rebase onto `main` (picks up #787 natives), open a PR for the Graph architecture map.
3. **Local signed-in smoke**: You / Hub / Intelligence Chat through Data Router digests (`DATA_ROUTER_CHAT_READS` on). Cloud smoke after SaaS pin when ready.

### Next code (isolation, Graph-aligned)

4. **[#779](https://github.com/ReBoticsAI/GodMode/issues/779) chat-first shard** under SQLite-universe `chats/` + Data Router mounts. Graph Chat bubbles are the UX face; Router remains the storage door. Prefer this before #780.
5. **Parallel:** [#591](https://github.com/ReBoticsAI/GodMode/issues/591) cgroups (prefer-before-#780 noisy neighbor).
6. **[#780](https://github.com/ReBoticsAI/GodMode/issues/780)** disposable job throwaway (strong container interim OK per #172).
7. **[#781](https://github.com/ReBoticsAI/GodMode/issues/781)** per-user runtime box wraps the Graph instance (You/Hub/Workspaces/agents inherit the box).
8. **[#782](https://github.com/ReBoticsAI/GodMode/issues/782)** dedicated VPS SKU last.

## Non-goals

- Do not block Graph on #781.
- Do not skip Data Router / #779 because “the Graph is the architecture.”
- Do not full `heart/` → `hub/` on-disk migration yet (alias only).
- Do not rename Intelligence vs Agents or change SaaS `deploymentMode: hub`.
- This file is local working order; updating the Project board is a separate step.

## Layer cheat sheet

| Layer | Job |
|-------|-----|
| Graph | Map users own (You, Hub, Workspaces, …) |
| SQLite universe + Data Router | Storage execution |
| Per-user box + job throwaway | Hard compute boundary |

## Related

- [DATA_ISOLATION.md](./DATA_ISOLATION.md)
- [SQLITE_UNIVERSE.md](./SQLITE_UNIVERSE.md)
- [GRAPH_MISSIONS.md](./GRAPH_MISSIONS.md)
