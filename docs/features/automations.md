---
slug: automations
title: "Automations"
section: "Productivity"
location: "Chat panel → Automations tab"
summary: "Workflows, Hooks, Schedules, and the kanban Tasks board in Chat."
---
# Automations

![automations in GodMode](/features/automations.png)


Automations live under Agents → Automations (and the Chat panel Automations tab).

## Workflows

Executable **guidance graphs** (trigger → skill/tool/agent nodes → output). Manage multiple named workflows per agent: create, switch, rename, enable, delete. Hooks and Schedules can run a workflow with `run_workflow`.

**Skills vs Workflows:** Skills (Knowledge) are reusable playbooks. Workflows orchestrate those playbooks and tools; they are not a second skill store.

### Seeded workflows

- **Autonomous Task Runner** — kanban backlog loop (optional schedule you attach yourself).
- **Scaffold domain plugin** — golden path for plugin self-expansion: load `plugin-authoring`, `scaffold_plugin` with domain / `openPluginDb`, implement, `build_plugin`, `install_plugin`, then prove create/list on plugin SQLite.

Run Scaffold domain plugin via Automations or:

```text
run_workflow workflowId=scaffold-domain-plugin input={"id":"my-plugin","name":"My Plugin"}
```

Input must be JSON with `id` and `name` (interpolated as `{{trigger.id}}` / `{{trigger.name}}`).

## Hooks and Schedules

GodMode event- and cron-driven automations (notify, run agents/workflows, coding gates). Coding tools emit coding.file / coding.shell events. Disk IDE hooks.json is discovery/compat only.

## Tasks board

The same kanban board as Tasks, surfaced inside Chat. Tag `auto` for the autonomous runner.

Hook definitions, `hook_runs`, and the PlatformEvent trigger log (`platform_events`) live in the **Workspace** database. Emitting a PlatformEvent requires a Workspace id. The Workspace durable outbox table also named `events` is a different subsystem.

See [[tasks]] and [[plugin-pipeline]].
