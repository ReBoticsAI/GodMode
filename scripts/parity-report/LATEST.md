# Kernel product-parity report

Generated: 2026-07-18T02:53:07.633Z

## Findings

### P0-cal-split (P0)

- **Class:** split_brain
- **Summary:** Agent Chat Calendar UI lists via GET /ai/calendar?agentId= but CalendarEvent Record mutations force user_id ownership.
- **Files:** apps/bridge/src/kernel/adapters/productivity.ts, apps/bridge/src/routes/ai.ts, apps/web/src/components/intelligence/IntelligencePanel.tsx:1571

### P0-ctx-agentId (P0)

- **Class:** silent_fallback
- **Summary:** HTTP OperationContext omits agentId (silent fallback to intelligence)
- **Files:** apps/bridge/src/kernel/routes.ts

### P0-knowledge-fallback (P0)

- **Class:** silent_fallback
- **Summary:** Memory/Artifact/Rule/Skill web creates pass activeAgentId into helpers that strip agent_id; HTTP Record context has no agentId → adapters stamp intelligence.
- **Files:** apps/bridge/src/kernel/adapters/content.ts, apps/web/src/api.ts, apps/web/src/pages/ai-settings/MemoryTab.tsx, apps/web/src/components/intelligence/IntelligencePanel.tsx

### P0-tasks-split (P0)

- **Class:** split_brain
- **Summary:** Agent Chat Tasks UI lists via GET /ai/projects?agentId= but TaskCard Record mutations force ensureUserProject (user board).
- **Files:** apps/bridge/src/kernel/adapters/productivity.ts, apps/bridge/src/routes/ai.ts, apps/web/src/pages/Automations.tsx:934

### P1-docs-calendar-agent (P1)

- **Class:** docs_lie
- **Summary:** FEATURES claims Calendar is available in Chat → Calendar tab (implies agent board), but writes go to personal user calendar via Record API.
- **Files:** docs/FEATURES.md

### P1-dropped-createCalendarEvent (P1)

- **Class:** dropped_client_agentId
- **Summary:** createCalendarEvent accepts agentId but does not send agent_id in Record payload
- **Files:** apps/web/src/api.ts

### P1-dropped-createProjectCard (P1)

- **Class:** dropped_client_agentId
- **Summary:** createProjectCard accepts agentId but does not send agent_id in Record payload
- **Files:** apps/web/src/api.ts

### P1-stale-ensureAgentProject (P1)

- **Class:** stale_comment
- **Summary:** ensureAgentProject comments still describe agent Kanban / todo_write ownership, but TaskCard adapter only calls ensureUserProject.
- **Files:** apps/bridge/src/services/user-productivity.ts

### P2-bank-claims (P2)

- **Class:** docs_lie
- **Summary:** FEATURES says Bank connects wallets for you and your agents, but FinanceConnection has no agent_id ownership column.
- **Files:** docs/FEATURES.md, apps/bridge/src/kernel/domains/finance.ts

## Domain gap matrix

| Domain | Verdict | Pre-migration | Mutate path | Web UI |
|---|---|---|---|---|
| productivity.tasks | `split_brain` | agent-owned ai_projects.agent_id (+ later user boards) | Record TaskCard → ensureUserProject only | /tasks (user); Chat Automations/projects (agent scope) |
| productivity.calendar | `split_brain` | agent-owned ai_calendar_events.agent_id | Record CalendarEvent → requireUser + user_id | /calendar (user); Chat Calendar tab (agent scope) |
| intelligence.memory | `silent_fallback` | agent-owned ai_memories.agent_id | Record Memory; adapter agentId(ctx) ?? intelligence | Chat Knowledge → Memory (passes activeAgentId; stripped) |
| intelligence.rules_skills_artifacts | `silent_fallback` | agent-owned / agent-enablement tables | Record API; HTTP ctx lacks agentId | Chat Knowledge tabs |
| automation.workflows | `silent_fallback_risk` | agent-owned ai_workflows.agent_id | Record Workflow (agent_id writable); HTTP ctx may still default | Chat Automations |
| automation.hooks | `parity_ok` | dual owner_kind user/agent | Record Hook | Automations (can filter by agent) |
| structure | `parity_ok` | tenant tree; optional agent attachment | Record + set_agent action | /structure |
| wiki | `parity_ok` | tenant + author_user_id | Record WikiPage | /wiki |
| messages | `parity_ok` | user conversations; agents as members | Record / delegated upload | Chat DMs |
| vault | `parity_ok` | tenant shared secrets | Record | /vault; Agents accounts |
| bank | `docs_lie` | tenant holdings (no agent column) | Record / platform actions | /bank; Chat Bank tab |
| kernel.http_context | `silent_fallback` | n/a (pre-kernel used /ai agentId) | POST /api/records/* builds context without agentId | all Record mutations |

## Read/write symmetry

- **TaskCard** — split_brain; mutate=user (ensureUserProject); agent lists=GET /api/ai/projects, GET /api/ai/projects/cards/:id/subtasks, GET /api/ai/projects/cards/:id/comments
- **CalendarEvent** — split_brain; mutate=user (user_id); agent lists=GET /api/ai/calendar/events, GET /api/ai/calendar/activity
- **Memory** — silent_fallback_risk; mutate=ctx.agentId ?? intelligence; agent lists=GET /api/ai/memories
- **Rule** — silent_fallback_risk; mutate=ctx.agentId ?? intelligence; agent lists=GET /api/ai/rules
- **Skill** — silent_fallback_risk; mutate=ctx.agentId ?? intelligence; agent lists=GET /api/ai/skills, GET /api/ai/skills/:id
- **Artifact** — silent_fallback_risk; mutate=ctx.agentId ?? intelligence; agent lists=GET /api/ai/artifacts, GET /api/ai/artifacts/:id
- **Workflow** — silent_fallback_risk; mutate=ctx.agentId ?? intelligence; agent lists=GET /api/ai/workflows, GET /api/ai/workflows/:id/comments, GET /api/ai/workflows/runs, GET /api/ai/workflows/runs/:id

## Recommendation

Default: **restore dual model** (personal OS user boards + per-agent Chat workspaces) by wiring HTTP `OperationContext.agentId` and restoring agent TaskCard/CalendarEvent paths for `kind: "agent"` UI. Alternative: collapse Chat tabs onto user boards and update FEATURES.
