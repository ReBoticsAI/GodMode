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

## Columns

Board columns live in `columns_json` on each board (not a hard-coded Backlog/Ready-only set).

- **Local boards:** Board settings → **Columns** to add, rename, reorder, hide, or remove columns. Optional **WIP** limit shows `count/limit` on the column header (warning style when over). Removing a column moves its cards to the first remaining visible column.
- **GitHub-linked boards:** On link and each Sync, column names and order refresh from the Project **Status** field options. Local **hide** and **WIP** values are preserved across Sync. Manage Status option names in GitHub Project settings when you need the shared board to change; then Sync.

Hidden columns keep their cards; they are just omitted from the board until unhidden.

## GitHub Project sync (optional)

1. **Settings → Connect GitHub** (GitHub App install + authorize; tokens in Vault). Sign-in with GitHub on Cloud uses the same App when configured.
2. Open a board’s settings and pick a GitHub Project you can access.
3. On link / Sync, board **columns follow the Project Status options** (and remap cards). Adjust the Status map in board settings if needed.
4. **Sync GitHub** pulls items into cards; moving/editing cards pushes Status, title, body, due, priority, labels, **assignees**, and **milestone** when mapped (Issues/PRs for assignees and milestone).
5. **Create:** New cards on a linked board are added to the Project as **Draft issues** by default. Edit assignees (comma-separated logins) and milestone title in the card Sheet; they push for linked Issues/PRs.
6. **Delete / remove:** Deleting a card in GodMode removes that item from the GitHub Project (the underlying Issue/PR is not deleted). Sync removes GodMode cards whose Project items were archived or removed on GitHub. Cards that never linked (no Project item id) stay local-only.
7. Linked boards **poll** GitHub in the background (default **1 minute**, clamped 1-30 min via `GITHUB_PROJECTS_SYNC_POLL_MS`). That poll is the near-real-time path for **user-owned** Projects. With a GitHub App installed on an **organization** that owns the Project, live `projects_v2_item` webhooks also drive pulls (handler is ready; GitHub only emits those events for org-owned Projects). Manual Sync always works. The toolbar shows last success, in-progress, and last error. Set `GITHUB_PROJECTS_SYNC_POLL_ENABLED=0` on the Bridge to disable background poll.
8. **Conflict policy:** last-write-wins. Pull overwrites mapped card fields from GitHub; push-on-edit overwrites those fields on GitHub. Matching is by stored Project item id.

Field map: title, description, column↔Status, due date, priority (P0–P3 ↔ Project Priority), labels, assignees, milestone. Agent assignment and prompts stay local. Card face fields (priority, labels, assignees, due, milestone) can be shown or hidden per board in the **Card fields** menu. Saving a card keeps GitHub sync metadata in `context_json` alongside attachments. You cannot sync a Project your token cannot access.

### Migration for existing boards

Boards created before multi-column sync get a default five-column `columns_json` on next open (schema backfill v19). Linked boards: run **Sync GitHub** once so columns match Status options and cards remap. Hide/WIP set after Sync stick on later pulls.

Kanban parity epic #259 (Done); GitHub App epic #266 (Done). Remaining Ready follow-ups: swimlanes / group-by (#274), board filter / search / sort (#276), Project field parity leftovers (#277), lifecycle polish for Issue create and archive vs delete (#278).

## Route

`/tasks`

The Automations tab in Chat shows the agent board ([[automations]]).
