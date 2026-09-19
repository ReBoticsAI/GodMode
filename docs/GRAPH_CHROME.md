# Graph chrome: ownership rule

Selecting a Graph node sets `informationNode` in Intelligence context. Owner-scoped Information surfaces (Calendar, Automations, Bank, Vault, and related focus chrome) read a single derived **`focusOwner`**, not a leftover `activeAgentId`.

## Flow

1. Click / activate a Graph node → `openInformationPanel(node)`.
2. `focusOwner = focusOwnerFromGraphNode(informationNode)` ([`apps/web/src/lib/graph-focus-owner.ts`](../apps/web/src/lib/graph-focus-owner.ts)).
3. Calendar maps `focusOwner` to `ProductivityScope` (You → `{ kind: "user" }`; agents → `{ kind: "agent", agentId }`).
4. When `focusOwner` is an agent, `activeAgentId` is synced for chat and legacy callers.

## Owner mapping (catalog sides)

| Graph signal | `focusOwner` |
|--------------|--------------|
| `hub:you`, `*-you`, `digital-you` / `you` | `{ kind: "user" }` |
| `hub:intelligence`, `*-intelligence` | `{ kind: "agent", agentId: "intelligence" }` |
| Research hub / `*-research` | `{ kind: "agent", agentId: "research" }` |
| Ops hub / `*-ops` | `{ kind: "agent", agentId: "ops" }` |
| `kind` agent or chat with `refId` | that agent (You aliases → user) |
| Platform chrome (wiki, admin, marketplace, Bridge, …) | `{ kind: "none" }` |

## Do not

- Scope Calendar from `activeAgentId` alone (breaks Intelligence / Research / Ops calendars).
- Treat You Calendar as agent `digital-you` (use user calendar APIs).
- Invent a second writable selection that can desync from `informationNode`.

## Related

- Epic [#793](https://github.com/ReBoticsAI/GodMode/issues/793) Graph chrome cohesion
- Issue [#794](https://github.com/ReBoticsAI/GodMode/issues/794) single `focusOwner`
- [STATE_GRAPH_ISOLATION.md](./STATE_GRAPH_ISOLATION.md)
