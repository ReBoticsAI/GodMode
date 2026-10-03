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
FloatingWindow / phone Sheet     z-[110]  (info focus z-[115]; chat z-[120])
Dialog / Select / Menu portals   z-[200]  (GRAPH_MODAL_Z; above floaters)
Primary Graph chrome             z-[210]  (ticker, notice, rails, composer / reply pill)
```

- Default FloatingWindow: [`FloatingWindow.tsx`](../apps/web/src/components/floating/FloatingWindow.tsx) uses `GRAPH_WINDOW_Z` (`z-[110]`).
- Modals and select/menu portals use [`GRAPH_MODAL_Z`](../apps/web/src/lib/graph-chrome-layout.ts) (`z-[200]`) so Dialog/Sheet overlay+content sit above all floaters.
- Primary chrome is **page-locked** (`fixed`) via [`GRAPH_PRIMARY_CHROME_Z`](../apps/web/src/lib/graph-chrome-layout.ts). Windows and phone Sheets are secondary and must not cover the footer or top ticker/notice.
- Window playfield bounds: `[data-graph-window-bounds]` between `GRAPH_TOP_CHROME_BAND` and `GRAPH_COMPOSER_BAND` ([`getFloatingWindowBounds`](../apps/web/src/lib/floating-window-bounds.ts)).
- Graph phone Sheets: no modal backdrop blur (`showOverlay={false}`, `modal={false}`); sit in the same playfield band (`GRAPH_WINDOW_Z` overrides Sheet default).
- Popovers that are not shadcn portals (for example fixed-position search lists) must clear windows when they open over Graph chrome.

## Social Chat directory

Social Chat uses a Discord-style sidebar (Cloud lobby / This install / DMs) for signed-in users and temporary visitors. Cloud lobby channels are `#general`, `#dev`, `#roadmap`, `#support`, `#thegame`. This install has `#local` only. See [dms-and-channels.md](./features/dms-and-channels.md).

Desktop default Social width aims for half the playfield, cut off just before the You / Intelligence hub column so those nodes stay visible beside the panel. Phone Social is fullscreen in the playfield band (open or closed only) and ignores this geometry. Manual resize on desktop may still grow larger.

### Channel agents on Graph

Each public channel has a Hub agent pin (`hub:channel-{slug}`, `refId: channel-{slug}`). Local installs always include `#local` (`hub:channel-local` plus vault/bank children). SaaS also pins Cloud lobby channel agents.

- Click / activate a channel-agent node opens Social on that lobby conversation and **possesses** `channel-{slug}` for Automations / Calendar / Knowledge / Bank / Vault (chat target stays the conversation).
- Visitor keep-set includes `hub:channel-local` (and its vault/bank). Cloud channel agents are not in the lean visitor keep-set.
- Channel Admins edit channel-agent content; everyone else can look. See roles in [dms-and-channels.md](./features/dms-and-channels.md).

## Chat window title picker

Focused Graph floating chat windows mount [`ChatTargetSearch`](../apps/web/src/components/intelligence/ChatTargetSearch.tsx) in the title (`titleMode` + `openFloatingOnSelect`). Selecting an agent, contact, or conversation updates `chatTarget` and calls `openOrFocusChatWindow` so the matching window focuses without leaving Graph land.

- Portal list uses `GRAPH_MODAL_Z` (`z-[200]`, same stack as Dialog / Sheet).
- Title wrapper uses `data-floating-chrome` so picker clicks do not start a window drag.
- `/w @agent` slash retarget is **not** wired yet: [`GraphEtherComposer`](../apps/web/src/components/graph/GraphEtherComposer.tsx) has no slash pipeline (slash lives in docked Intelligence composer). Alternate open paths: Graph node / Agents browse actions.

## Information tabs

Canonical canvas strip on a Graph node Information window: **Overview / Pipeline / Automations** (shadcn `Tabs` + `TabsList` line variant in [`InformationFloatingPanel.tsx`](../apps/web/src/components/intelligence/InformationFloatingPanel.tsx)).

Owner surfaces (Calendar, Structure, Knowledge, Automations list, Vault, …) open as left-rail / floating tabs and still follow `focusOwner`.

## Open paths

All Graph chrome entry points that open a floating Information surface go through **`openGraphSurface`** ([`use-graph-floating-openers.ts`](../apps/web/src/lib/use-graph-floating-openers.ts)), backed by [`GRAPH_FLOATING_SURFACES`](../apps/web/src/lib/graph-floating-surfaces.ts).

### Inventory

| Entry | How it opens |
|-------|----------------|
| Left-rail icon | `openGraphSurface({ tab })` when the tab is in the catalog; else `openLeftRailTab` (e.g. Knowledge, Automations/`projects`, agent Vault) |
| Deep link (`/calendar`, `/wiki`, …) | `App.tsx` → `godmode:open-*` event → opener with current `focusOwner` |
| Action menu / smart suggest | Prefer `open_panel` with a catalog tab; floating-index `navigate` paths are remapped via `resolveFloatingSurface` → `openGraphSurface` |
| Architecture catalog CTA | Node select / activate → Information panel; `openImmediate` opens the matching left-rail tab |
| Information Overview CTA | `runCta` dispatches the catalog event (or remaps navigate via `resolveFloatingSurface`); no incomplete parallel match list |

### Owner-aware hubs

Catalog defaults use the You-side node id (`hub:calendar-you`, `hub:bank-you`, …). `resolveFloatingNodeId` rewrites those to the current `focusOwner` side (`hub:calendar-intelligence`, …) so left rail, deep link, and menus agree on scope.

### Automations (two chrome surfaces)

- Left-rail **`projects`**: Automations list panel (tasks / workflows / hooks / schedules).
- Information **`canvasMode: automations`**: embedded editor on automations-family Graph nodes.

Do not treat one as a dead path of the other; both stay until a later fold.

### Do not (open paths)

- Add new Graph chrome `navigate` calls to floating index paths without remapping through `openGraphSurface`.
- Hardcode `hub:calendar-you` (or other `-you` hubs) when opening from a non-You focus.
- Grow incomplete `surfaceMatch` arrays that omit catalog surfaces (use `resolveFloatingSurface`).

## Desktop vs phone

| | Desktop (≥640px) | Phone (&lt;640px) |
|--|------------------|-----------------|
| Land | Graph + multi [`FloatingWindow`](../apps/web/src/components/floating/FloatingWindow.tsx); Social auto-opens | Graph overview (`lowPower` OK for R3F); **Social still auto-opens** in the playfield |
| Primary surface | FloatingWindow (`z-[110]`, focused chat may `z-[120]`) | One fullscreen surface at a time: [`GraphPhoneSheet`](../apps/web/src/components/graph/GraphPhoneSheet.tsx) or Social using the same top/composer band insets (`z-[110]`/`z-[120]`). **Open or closed** (no resize, maximize, or minimize) |
| Navigation | Multi-window floats; no History stack | [`phone-surface-stack.ts`](../apps/web/src/lib/phone-surface-stack.ts): navigate pushes prior surface; Back pops, then falls back to Social Chat (never Graph); X dismisses to Graph but keeps the closed surface on the stack |
| Guide / CTAs | `open_surface` may auto-open windows | No auto surface swap: toast with **Open** action; tap replaces the current surface |
| Composer | [`GraphEtherComposer`](../apps/web/src/components/graph/GraphEtherComposer.tsx) fixed footer (`z-[210]`) | Same fixed footer band; Sheet / Social ends above the reply pill / composer |
| Focus | Multiple floats OK; windows stay under primary chrome | Mutual replace: Social vs Information vs DM thread; no stacked Sheets; no sheet backdrop blur |
| Density | Per-window default `1.0` | Unset prefs default to `0.9`; title-bar zoom on Social and GraphPhoneSheet; put `zoom` on the same `min-h-0 overflow-y-auto` node (not an overflow-hidden parent) so tall Cloud / Inference sheets still scroll |
| Breakpoint | Tablets 640–1023 keep multi-window float | [`PHONE_BREAKPOINT`](../apps/web/src/hooks/use-mobile.ts) / `useIsPhone()` |

### Smoke (phone viewport)

1. DevTools width ~390px (or real device). Guest or new-user land preferred.
2. Social is visible in the playfield on land (under ticker/notice, above composer); side rails stay usable.
3. From Social, open a deferred link (guide / CTA toast **Open**) or left-rail Calendar / Personal Vault → surface fills playfield; Social is not stacked behind it.
4. Browser / Android Back (or title-bar chevron): Calendar → Social; from a surface with empty stack → Social Chat (not Graph). X close → Graph; open another node → Back restores the X'd surface.
5. Density zoom out/in still scrolls; no second Sheet behind Social.
6. No resize or maximize controls on phone windows.

PWA installability (manifest, service worker, Add to Home Screen) stays on [#75](https://github.com/ReBoticsAI/GodMode/issues/75) / [#419](https://github.com/ReBoticsAI/GodMode/issues/419) / [#387](https://github.com/ReBoticsAI/GodMode/issues/387). This issue owns the viewport shell contract only.

Automations dual chrome from #797 still applies: left-rail `projects` list vs Information `canvasMode: automations` editor.

## Empty, loading, and errors

Prefer installed shadcn primitives from `apps/web/src/components/ui/`:

- **Empty** (`Empty`, `EmptyHeader`, `EmptyTitle`, `EmptyDescription`) for no-data states
- **Spinner** for in-panel loading
- **Alert** for recoverable errors

Do not invent a second empty language with one-off muted paragraphs when these primitives fit.

## Window content density

Each floating window (and Social) can set its own **content density** from the title bar (zoom out / zoom in). Preferences persist per `windowId` in `godmode.windowDensity` ([`floating-window-density.ts`](../apps/web/src/lib/floating-window-density.ts)). Social uses id `chat`; Information phone Sheets use `information`. This scales body UI only (not the title chrome) and is independent of focus-pair **window scale** (outer frame size on the Graph). On phone, missing prefs default to `0.9` so first paint stays readable.

## Embedded editors (density)

Pipeline and Workflows stay embedded in Information. Keep inspectors narrow; avoid dumping multi-MB request bodies into the UI (see #791 / #798). Prefer `min-h-0` flex children so panels scroll inside the floating window. **Final LLM Request** defaults to a truncated head/tail preview with Copy full and Show full (#791).

## Performance budgets

- **Information tabs:** Overview / Pipeline / Automations mount heavy editors only while that tab is active. Switching away unmounts React Flow trees so they do not compete with The Graph (#798). Editors are `React.lazy` + `Suspense`.
- **Final LLM Request:** truncated inspector preview by default (#791); copy / expand for the full prompt.
- **R3F Graph:** [`GraphScene3D.tsx`](../apps/web/src/components/graph/GraphScene3D.tsx) uses `frameloop="demand"`, capped `dpr` (≤1.25), and SVG `Html` glyphs for `visibleNodes` only.
- Prefer `min-h-0` flex children; do not dump multi-MB payloads into inspectors.

## Forbidden

- Raw one-off color kits (`bg-blue-500`, parallel brand palettes) when a semantic token exists
- Parallel component libraries (MUI, Chakra, …) on GodMode chrome
- New ad-hoc `z-[N]` islands that ignore the stack contract above
- New parallel floating shells that duplicate FloatingWindow (migrate callers over time; do not grow new ones)
- Phone full-bleed floats or modal sheet blur that bury the bottom composer (use GraphPhoneSheet playfield + fixed primary chrome)

## Related

- Epic [#793](https://github.com/ReBoticsAI/GodMode/issues/793) Graph chrome cohesion
- Issue [#790](https://github.com/ReBoticsAI/GodMode/issues/790) chat window title target picker
- Issue [#791](https://github.com/ReBoticsAI/GodMode/issues/791) Pipeline Final LLM Request preview
- Issue [#798](https://github.com/ReBoticsAI/GodMode/issues/798) embedded editor performance budgets
- Issue [#796](https://github.com/ReBoticsAI/GodMode/issues/796) Graph mobile / phone shell
- Issue [#797](https://github.com/ReBoticsAI/GodMode/issues/797) collapse parallel open paths
- Issue [#794](https://github.com/ReBoticsAI/GodMode/issues/794) single `focusOwner`
- Issue [#795](https://github.com/ReBoticsAI/GodMode/issues/795) style guide
- [STATE_GRAPH_ISOLATION.md](./STATE_GRAPH_ISOLATION.md)
- [CONTRIBUTING.md](../CONTRIBUTING.md)
