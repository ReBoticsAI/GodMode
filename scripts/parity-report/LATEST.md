# Kernel product-parity report

Generated: 2026-07-18T03:10:43.659Z

## Findings

### P2-bank-claims (P2)

- **Class:** docs_lie
- **Summary:** FEATURES says Bank connects wallets for you and your agents, but FinanceConnection has no agent_id ownership column.
- **Files:** docs/FEATURES.md, apps/bridge/src/kernel/domains/finance.ts

## Domain gap matrix

| Domain | Verdict | Pre-migration | Mutate path | Web UI |
|---|---|---|---|---|
| productivity.tasks | `parity_ok` | agent-owned ai_projects.agent_id (+ later user boards) | Record TaskCard → ensureUserProject (personal) / ensureAgentProject (ctx.agentId) | /tasks (user); Chat Automations/projects (agent scope) |
| productivity.calendar | `parity_ok` | agent-owned ai_calendar_events.agent_id | Record CalendarEvent → user_id OR agent_id via ctx.agentId | /calendar (user); Chat Calendar tab (agent scope) |
| intelligence.memory | `parity_ok` | agent-owned ai_memories.agent_id | Record Memory; adapter agentId(ctx) with HTTP ?agentId= | Chat Knowledge → Memory (passes activeAgentId via ?agentId=) |
| intelligence.rules_skills_artifacts | `parity_ok` | agent-owned / agent-enablement tables | Record API; HTTP ctx.agentId from ?agentId= | Chat Knowledge tabs |
| automation.workflows | `parity_ok` | agent-owned ai_workflows.agent_id | Record Workflow; HTTP ctx.agentId when scoped | Chat Automations |
| automation.hooks | `parity_ok` | dual owner_kind user/agent | Record Hook | Automations (can filter by agent) |
| structure | `parity_ok` | tenant tree; optional agent attachment | Record + set_agent action | /structure |
| wiki | `parity_ok` | tenant + author_user_id | Record WikiPage | /wiki |
| messages | `parity_ok` | user conversations; agents as members | Record / delegated upload | Chat DMs |
| vault | `parity_ok` | tenant shared secrets | Record | /vault; Agents accounts |
| bank | `docs_lie` | tenant holdings (no agent column) | Record / platform actions | /bank; Chat Bank tab |
| kernel.http_context | `parity_ok` | n/a (pre-kernel used /ai agentId) | POST /api/records/* sets ctx.agentId from ?agentId= / X-GodMode-Agent-Id | all Record mutations |

## Read/write symmetry

- **TaskCard** — ok_or_agent_only; mutate=dual (ensureUserProject | ensureAgentProject via ctx.agentId); agent lists=GET /api/ai/projects, GET /api/ai/projects/cards/:id/subtasks, GET /api/ai/projects/cards/:id/comments
- **CalendarEvent** — ok_or_agent_only; mutate=dual (user_id | agent_id via ctx.agentId); agent lists=GET /api/ai/calendar/events, GET /api/ai/calendar/activity
- **Memory** — ok_or_agent_only; mutate=ctx.agentId (HTTP ?agentId= / header); agent lists=GET /api/ai/memories
- **Rule** — ok_or_agent_only; mutate=ctx.agentId (HTTP ?agentId= / header); agent lists=GET /api/ai/rules
- **Skill** — ok_or_agent_only; mutate=ctx.agentId (HTTP ?agentId= / header); agent lists=GET /api/ai/skills, GET /api/ai/skills/:id
- **Artifact** — ok_or_agent_only; mutate=ctx.agentId (HTTP ?agentId= / header); agent lists=GET /api/ai/artifacts, GET /api/ai/artifacts/:id
- **Workflow** — ok_or_agent_only; mutate=ctx.agentId (HTTP ?agentId= / header); agent lists=GET /api/ai/workflows, GET /api/ai/workflows/:id/comments, GET /api/ai/workflows/runs, GET /api/ai/workflows/runs/:id

## Recommendation

Default: **restore dual model** (personal OS user boards + per-agent Chat workspaces) by wiring HTTP `OperationContext.agentId` and restoring agent TaskCard/CalendarEvent paths for `kind: "agent"` UI. Alternative: collapse Chat tabs onto user boards and update FEATURES.
