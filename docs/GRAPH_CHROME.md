# Graph chrome

Rules for The Graph floating chrome and Information surfaces. New Graph UI must follow this guide.

## Ownership (`focusOwner`)

Selecting a Graph node sets `informationNode` in Intelligence context. Owner-scoped Information surfaces (Calendar, Automations, Bank, Vault, and related focus chrome) read a single derived **`focusOwner`**, not a leftover `activeAgentId`.

### Flow

1. Click / activate a Graph node → `openInformationPanel(node)`.
2. `focusOwner = focusOwnerFromGraphNode(informationNode)` ([`apps/web/src/lib/graph-focus-owner.ts`](../apps/web/src/lib/graph-focus-owner.ts)).
3. Calendar maps `focusOwner` to `ProductivityScope` (You → `{ kind: "user" }`; agents → `{ kind: "agent", agentId }`).
4. When `focusOwner` is an agent, `activeAgentId` is synced for chat and legacy callers.

### Owner mapping (catalog sides)

| Graph signal | `focusOwner` |
|--------------|--------------|
| `hub:you`, `*-you`, `digital-you` / `you` | `{ kind: "user" }` |
| `hub:intelligence`, `*-intelligence` | `{ kind: "agent", agentId: "intelligence" }` |
| Research hub / `*-research` | `{ kind: "agent", agentId: "research" }` |
| Ops hub / `*-ops` | `{ kind: "agent", agentId: "ops" }` |
| `kind` agent or chat with `refId` | that agent (You aliases → user) |
| Platform chrome (wiki, admin, marketplace, Bridge, …) | `{ kind: "none" }` |

### Do not (ownership)

- Scope Calendar from `activeAgentId` alone (breaks Intelligence / Research / Ops calendars).
- Treat You Calendar as agent `digital-you` (use user calendar APIs).
- Invent a second writable selection that can desync from `informationNode`.

## Z-stack

```text
FloatingWindow / chat chrome     z-[110]  (focused chat may use z-[120])
Dialog / Sheet / Select / Menu   z-[200]  (portals above floating chrome)
```

- Default FloatingWindow: [`FloatingWindow.tsx`](../apps/web/src/components/floating/FloatingWindow.tsx) `zIndexClassName = "z-[110]"`.
- Portals: Dialog, Sheet, Select, DropdownMenu use `z-[200]` so overlays are not trapped under floating chrome.
- Popovers that are not shadcn portals (for example fixed-position search lists) must also use `z-[200]` when they open over Graph windows.

## Chat window title picker

Focused Graph floating chat windows mount [`ChatTargetSearch`](../apps/web/src/components/intelligence/ChatTargetSearch.tsx) in the title (`titleMode` + `openFloatingOnSelect`). Selecting an agent, contact, or conversation updates `chatTarget` and calls `openOrFocusChatWindow` so the matching window focuses without leaving Graph land.

- Portal list uses `z-[200]` (same stack as Dialog / Sheet).
- Title wrapper uses `data-floating-chrome` so picker clicks do not start a window drag.
- `/w @agent` slash retarget is **not** wired yet: [`GraphEtherComposer`](../apps/web/src/components/graph/GraphEtherComposer.tsx) has no slash pipeline (slash lives in docked Intelligence composer). Alternate open paths: Graph node / Agents browse actions.

## Information tabs

Canonical canvas strip on a Graph node Information window: **Overview / Pipeline / Automations** (shadcn `Tabs` + `TabsList` line variant in [`InformationFloatingPanel.tsx`](../apps/web/src/components/intelligence/InformationFloatingPanel.tsx)).

Owner surfaces (Calendar, Structure, Knowledge, Automations list, Vault, …) open as left-rail / floating tabs and still follow `focusOwner`.

## Empty, loading, and errors

Prefer installed shadcn primitives from `apps/web/src/components/ui/`:

- **Empty** (`Empty`, `EmptyHeader`, `EmptyTitle`, `EmptyDescription`) for no-data states
- **Spinner** for in-panel loading
- **Alert** for recoverable errors

Do not invent a second empty language with one-off muted paragraphs when these primitives fit.

## Embedded editors (density)

Pipeline and Workflows stay embedded in Information. Keep inspectors narrow; avoid dumping multi-MB request bodies into the UI (see #791 / #798). Prefer `min-h-0` flex children so panels scroll inside the floating window. **Final LLM Request** defaults to a truncated head/tail preview with Copy full and Show full (#791). Broader Workflows / R3F budgets remain #798.

## Forbidden

- Raw one-off color kits (`bg-blue-500`, parallel brand palettes) when a semantic token exists
- Parallel component libraries (MUI, Chakra, …) on GodMode chrome
- New ad-hoc `z-[N]` islands that ignore the stack contract above
- New parallel floating shells that duplicate FloatingWindow (migrate callers over time; do not grow new ones)

## Related

- Epic [#793](https://github.com/ReBoticsAI/GodMode/issues/793) Graph chrome cohesion
- Issue [#790](https://github.com/ReBoticsAI/GodMode/issues/790) chat window title target picker
- Issue [#791](https://github.com/ReBoticsAI/GodMode/issues/791) Pipeline Final LLM Request preview
- Issue [#794](https://github.com/ReBoticsAI/GodMode/issues/794) single `focusOwner`
- Issue [#795](https://github.com/ReBoticsAI/GodMode/issues/795) style guide
- [STATE_GRAPH_ISOLATION.md](./STATE_GRAPH_ISOLATION.md)
- [CONTRIBUTING.md](../CONTRIBUTING.md)
