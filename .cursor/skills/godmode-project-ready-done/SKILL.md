---
name: godmode-project-ready-done
description: >-
  Runs the GodMode GitHub Project Ready-to-Done loop: pick a Ready P0, move to
  In progress, implement, test, commit, open PR, merge when CI green, mark Done,
  then optionally plan the next Ready P0. Use when the user asks to tackle Ready
  column issues, work the roadmap project, ship P0s end-to-end, or continue the
  Ready → Done flow for https://github.com/users/ReBoticsAI/projects/1.
---

# GodMode Project: Ready → Done

## Project constants

| Item | Value |
|------|-------|
| Project | `https://github.com/users/ReBoticsAI/projects/1` (number **1**, owner **ReBoticsAI**) |
| Project node id | `PVT_kwHODvOEJs4BeDG0` |
| Status field | `PVTSSF_lAHODvOEJs4BeDG0zhYgLOE` |
| Priority field | `PVTSSF_lAHODvOEJs4BeDG0zhYgLc4` |

### Status option ids

| Column | Option id |
|--------|-----------|
| Backlog | `f75ad846` |
| Ready | `61e4505c` |
| In progress | `47fc9ee4` |
| In review | `df73e18b` |
| Done | `98236657` |

### Priority option ids

| Priority | Option id |
|----------|-----------|
| P0 | `79628723` |
| P1 | `0a877460` |
| P2 | `da944a9c` |

Set status (example → In progress):

```bash
gh api graphql -f query='mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
    value: { singleSelectOptionId: $optionId }
  }) { projectV2Item { id } }
}' -f projectId='PVT_kwHODvOEJs4BeDG0' \
  -f itemId='ITEM_ID' \
  -f fieldId='PVTSSF_lAHODvOEJs4BeDG0zhYgLOE' \
  -f optionId='47fc9ee4'
```

List items: `gh project item-list 1 --owner ReBoticsAI --format json --limit 100`

Add issue to project: `gh project item-add 1 --owner ReBoticsAI --url https://github.com/ReBoticsAI/GodMode/issues/N --format json`

## Loop (one issue at a time)

1. **Pick** from Ready, prefer **P0**. Choose the smallest shippable issue that unblocks others (scoped polish before huge epics; for epics, plan a **first slice** only).
2. **Plan** (Plan mode when the change is non-trivial): concrete files, acceptance, out of scope. Do not edit the plan file after approval unless asked.
3. **In progress**: move the project item Status → In progress before coding.
4. **Implement** against the approved plan. Mark plan todos in progress/completed as you go. Do not recreate todos.
5. **Test**: run focused Vitest / typecheck for touched paths before claiming done.
6. **Commit + PR** on a feature branch (never commit straight to `main` unless user says so):
   - Follow repo commit/PR user rules (status/diff/log, HEREDOC messages, `gh pr create`).
   - `Closes #N` only when the issue outcome is fully met.
   - For multi-slice epics: `Part of #N` + progress comment; leave the epic open unless the user asks to mark Done.
7. **CI**: `gh run watch <id> --exit-status` (or `gh pr checks --watch`). If queued forever, empty-commit retrigger once. Merge only when required checks are green (`gh pr merge --merge --delete-branch`). If policy blocks briefly, wait for the latest check; do not `--admin` unless the user asks.
8. **Done**: move project item Status → Done after merge.
9. **Next**: pull `main`, enter Plan mode, pick the next Ready P0 (or the next slice of an open epic).

## Selection heuristics

- Prefer **scoped** P0s with clear acceptance over XL platform epics.
- If the only P0 is an epic, ship **one checklist slice**, keep the epic open, comment progress.
- Create a **follow-up issue** for deferred callers/infra; add it to the project Ready (set Priority) rather than leaving work only in a plan "out of scope" note.
- Respect OSS core rules: no Sierra/Polymarket/private plugin residue in public GodMode.

## Anti-patterns

- Do not mark an epic Done after only a first slice unless the user explicitly wants that.
- Do not re-fire global one-shot hooks (e.g. `server:beforeListen`) to fake hot-reload.
- Do not dump or paste leaked proprietary system prompts; use heading/structure parity only.
- Do not start the next issue's coding until the current PR is merged (or the user says to stack).
