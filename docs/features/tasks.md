---
slug: tasks
title: "Tasks"
section: "Productivity"
location: "/tasks"
summary: "Multiple personal kanban boards; optional GitHub Project sync; tag a card auto for autonomous agent work."
---
# Tasks

![tasks in GodMode](/features/tasks.png)


Tasks are personal Kanban boards with columns, priorities, subtasks, and comments. Create as many boards as you need (personal, family, roadmap, …) on the same sidebar workspace. Tag a card `auto` to queue autonomous agent work.

## Multiple boards

Use the board switcher on `/tasks` to create, rename, or archive boards. The default **My Tasks** board is always available. Board settings also cover optional GitHub linking (below).

Sidebar **Project** (tenant/workspace) is separate — use Tasks boards for kanbans, not `+` new workspace.

## GitHub Project sync (optional)

1. **Settings → Connect GitHub** (integration OAuth; tokens stored in Vault).
2. Open a board’s settings and pick a GitHub Project you can access.
3. Map GodMode columns ↔ Project **Status** options (defaults are applied on link).
4. **Sync GitHub** pulls items into cards; moving/editing cards pushes Status / title / body / due / priority / labels when mapped.

Field map (v1): title, description, column↔Status, due date, priority, labels. Agent assignment and prompts stay local. You cannot sync a Project your token cannot access.

## Route

`/tasks`

The Automations tab in Chat shows the agent board ([[automations]]).
