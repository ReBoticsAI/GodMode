# Cursor parity blind eval harness (#71)

Lightweight prompt set for comparing **Cursor IDE** vs GodMode Intelligence
(`cursor_cloud`) on the same model. This is an acceptance aid, not an automated
CI gate.

## How to run

1. Open the same repo in Cursor IDE and in GodMode (coding root = this repo).
2. Use the same model id when possible (e.g. `composer-2.5` or `auto`).
3. For each prompt below, run once in IDE Agent and once in GodMode Intelligence
   (Agent mode, tool autonomy as needed).
4. Score with the rubric; record notes in a private doc (do not commit secrets).

## Rubric (per prompt, 0-2 each)

| Dimension | 0 | 1 | 2 |
|-----------|---|---|---|
| Correctness | Wrong / harmful | Partial | Correct outcome |
| Tool use | Wasteful or missing | Adequate | Efficient, parallel when useful |
| Edit discipline | Drive-by churn | Mostly focused | Minimal correct diff |
| Continuity | Lost thread | Recovered | Stayed coherent |

Target: GodMode within 1 point of IDE on average for the same model.

## Prompt set

### P1 - Locate then explain
> Where is Intelligence chat compaction implemented, and what happens when
> history exceeds the budget?

Expect: finds `compactAgentMessages` / scratchpad path; accurate explanation.

### P2 - Small focused edit
> In `docs/CURSOR_SUBSCRIPTION.md`, add one sentence under MCP noting the
> 8-server inline cap. Do not change other sections.

Expect: single-file edit; confirm preview if required; no unrelated churn.

### P3 - Multi-step with tools
> List the exported helpers in `cursor-mcp-config.ts`, then add a one-line JSDoc
> on `resolveMcpFromWorkspace` if missing. Summarize what you changed.

Expect: read then optional tiny edit; clear summary.

### P4 - Plan mode
> Switch to Plan mode. Propose how to add a Bridge MCP client for local backends
> without spawning on SaaS by default. Do not implement.

Expect: plan only; no writes.

### P5 - Rules awareness
> What always-apply workspace rules should affect Intelligence in this repo?
> Cite rule ids or file names.

Expect: sees `.cursor/rules` / AGENTS via SDK or Knowledge depending on backend.

## Recording template

```
Date:
Model:
GodMode backend: cursor_cloud | local | …
P1 IDE: / GM:  notes:
P2 IDE: / GM:  notes:
P3 IDE: / GM:  notes:
P4 IDE: / GM:  notes:
P5 IDE: / GM:  notes:
Average delta (GM - IDE):
```

## Out of scope here

- True semantic search quality (#69)
- Browser / CDP parity
- Full automated scoring
