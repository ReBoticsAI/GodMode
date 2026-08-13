# Cursor parity blind eval harness (#71 / #447)

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

## Semantic codebase search (#447)

Use these after the hybrid `codebase_search` path is available (code embedding
profile optional; soft-fail to grep is allowed). Score **hit quality** separately
from the general rubric above.

### Agreed bar

On this mid-size TypeScript monorepo (GodMode), for each S-prompt below:

- **Pass**: top results (or the first `read_file` after search) include the
  expected file or symbol without the human pointing at a path.
- **Soft-fail OK**: if the embedder is down, `codebase_search` returns
  `mode=grep` with an explicit `note` / `fallbackReason`, then grep/glob
  recovers the same target. Silent empty results presented as "nothing exists"
  are a fail.
- **Target**: at least **3 of 4** S-prompts pass on a warm or soft-fail path in
  one sitting (same model as the P-set when possible).

### S1 - Compaction owner
> Where is chat history compaction handled when the message budget is exceeded?

Expect: hits compaction / `compactAgentMessages` (or adjacent) without a path hint.

### S2 - Hybrid search implementation
> Where is semantic codebase search implemented, and how does it fall back when
> embeddings are unavailable?

Expect: `codebase-search.ts` / hybrid soft-fail path; accurate soft-fail description.

### S3 - Embed profile routing
> How does the code embedding profile differ from the memory profile for search?

Expect: points at embed profiles / `AGENT_MEMORY` docs or `profiles.ts`; not wiki RAG.

### S4 - Harness search routing
> When should a coding agent use codebase_search versus grep?

Expect: NL / exploratory vs exact identifier; cites harness or tool description intent.

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
S1 pass/fail notes:
S2 pass/fail notes:
S3 pass/fail notes:
S4 pass/fail notes:
Semantic bar (3/4): pass | fail
```

## Out of scope here

- Replacing wiki/memory RAG (#383)
- Full automated scoring CI gate
- Browser / CDP parity
