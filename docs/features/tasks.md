---
slug: tasks
title: "Tasks"
section: "Productivity"
location: "/tasks"
summary: "Multiple personal kanban boards; optional GitHub Project sync; tag a card auto for autonomous agent work."
---
# Tasks

![tasks in GodMode](/features/tasks.png)


Tasks are personal Kanban boards with columns, priorities (P0–P3), subtasks, and comments. Create as many boards as you need (personal, family, roadmap, …) on the same sidebar workspace. Tag a card `auto` to queue autonomous agent work. The board layout scrolls horizontally so every column stays reachable; card detail opens in a side panel.

## Multiple boards

Use the board switcher on `/tasks` to create, rename, or archive boards. The default **My Tasks** board is always available. Board settings also cover optional GitHub linking (below).

Sidebar **Project** (tenant/workspace) is separate: use Tasks boards for kanbans, not `+` new workspace.

## GitHub Project sync (optional)

1. **Settings → Connect GitHub** (GitHub App install + authorize; tokens in Vault). Sign-in with GitHub on Cloud uses the same App when configured.
2. Open a board’s settings and pick a GitHub Project you can access.
3. On link / Sync, board **columns follow the Project Status options** (and remap cards). Adjust the Status map in board settings if needed.
4. **Sync GitHub** pulls items into cards; moving/editing cards pushes Status / title / body / due / priority / labels when mapped.
5. Linked boards **poll** GitHub in the background (default about every 3 minutes). With a GitHub App installed on an **organization** that owns the Project, **Projects v2 item webhooks** also drive pulls. User-owned Projects rely on poll + manual Sync (GitHub does not reliably emit item webhooks for personal boards). The toolbar shows last success, in-progress, and last error. Set `GITHUB_PROJECTS_SYNC_POLL_MS` / `GITHUB_PROJECTS_SYNC_POLL_ENABLED=0` on the Bridge if needed.
6. **Conflict policy:** last-write-wins. Pull overwrites mapped card fields from GitHub; push-on-edit overwrites those fields on GitHub. Matching is by stored Project item id. Deletes/archive both ways are a later slice.

Field map (v1+): title, description, column↔Status, due date, priority (P0–P3 ↔ Project Priority), labels, **assignees** and **milestone** (pulled into card face / detail on Sync; assignees and milestone are read-only in GodMode until a later slice). Agent assignment and prompts stay local. Card face fields (priority, labels, assignees, due, milestone) can be shown or hidden per board in the **Card fields** menu. Saving a card keeps GitHub sync metadata in `context_json` alongside attachments. You cannot sync a Project your token cannot access.

Kanban parity epic #259; GitHub App epic #266.

## Route

`/tasks`

The Automations tab in Chat shows the agent board ([[automations]]).
