---
slug: support
title: "Support"
section: "Productivity"
location: "/support"
summary: "Agent Support skill: gather then report or offer a Core fix PR; local Issues/PR Agents triage and merge under a strict matrix."
---
# Support

![support in GodMode](/features/support.png)

Support intake is **Agent-first**. Chat Intelligence (or any entitled Agent) and `use_skill('support')`.

Gather is conversational (1–3 turns), so there is no durable `ai_workflows` graph for intake (unlike `scaffold-domain-plugin`). Reliability comes from aligned tool schemas, stripping signup-only `ask_guide_choice` on normal chat, and Support intake harness injection on Bug pill / Log / Handoff turns.

## End-user loop (any install)

The Graph composer **Bug** pill captures a screenshot, asks what looks wrong, then opens Intelligence. The Support skill:

1. Gathers any missing expected vs actual / repro (short turns).
2. Asks whether to **log a bug for developers** or **hand off to a coding subagent** for a focused fix PR (`ask_user_choice`; defaults match that pair).
3. Always files via `report_platform_issue` when logging or before a fix PR (dedupe on strong match). Screenshots embed on the GitHub issue.
4. On handoff: Vault GitHub Connect → fork → implement → `github_pr_create` to `ReBoticsAI/GodMode`. **Never merges** on the user side.

Private paths stay separate:

- **`report_admin_ops`** — Hub/Cloud billing/account/staging. Not public GitHub.
- **`report_shared_resource_issue`** — Notifies the share-grant owner (and staff cc).

## Maintainer loop (operator / local GodMode)

On the operator tenant, bootstrap seeds:

- **Core Issues** Agent (`support-triage`) woken by `support.platform_issue.reported` (App webhooks for Core `issues` / `issue_comment`, plus Agent-filed reports). On Cloud Admin the agent uses Cursor (`cursor_cloud`); wake does not require a local chat GGUF.
- **Core PRs** Agent (`support-pr-review`) woken by `support.platform_pr.updated` (`pull_request` webhooks for opened/synchronize/reopened/ready_for_review/edited). Same Cursor-on-Cloud Admin path.

Notify hooks also fire for staff. Core PRs may call `github_pr_merge` only on the operator tenant. The tool fail-closes unless every hard gate passes (CI green via `watch_pr_checks`, base `main`, not draft, mergeable, diff scope/size, author allowlist or `maintainers:ok-to-merge`, clean title/body). Set `GODMODE_PR_MERGE_AUTHOR_ALLOWLIST` (comma-separated GitHub logins) on the maintainer host.

After merge to `main`, Publish SaaS / Waiting Deploy → Done remains the deploy path. Agents do not claim Cloud is live until that automation finishes.

## Automations

Seeded notify hooks: `support.platform_issue.reported`, `support.platform_pr.updated`, `ops.report.created`, `support.resource_issue.reported`. Maintainer wake hooks use `run_agent` for Core Issues / Core PRs.

Staff membership still lives in Admin → Support (Support group). The legacy in-app ticket inbox is retired as the source of truth for new reports.

## Route

`/support` (guides you to Intelligence chat)
