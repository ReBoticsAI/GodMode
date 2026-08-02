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

## Filter, search, and sort

Each board has a filter bar (search, priority, labels, assignees, milestone, column/Status, and sort). Filters apply to visible cards only and do not break drag-and-drop or GitHub push-on-edit. Preferences persist for the browser session per board. Clear filters when nothing matches.

## Swimlanes / group-by

Optional **Group by** on the board toolbar: None, Priority (P0–P3 lanes), or Assignee (plus Unassigned). Lanes stack vertically; columns stay horizontal inside each lane. Dragging a card into another Priority lane updates that card’s priority. Works on local and GitHub-linked boards. Preference persists for the browser session per board.

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
5. **Create:** On a linked board, **Add card** asks how to create: **Draft on Project** (default), **Issue in a repository** (repo picker from repos the connected token can access), or **Local only**. Assignees (comma-separated logins) and milestone title in the card Sheet push for linked Issues/PRs.
6. **Archive vs remove:** **Archive** archives the Project item on GitHub and removes the local card (Issue/PR kept). **Remove from Project** deletes the Project item only (Issue/PR kept; Draft items go away with the item). GodMode never deletes the underlying Issue/PR from here. Sync drops local cards when items are archived or removed on GitHub. Cards that never linked (no Project item id) are local-only deletes.
7. Linked boards **poll** GitHub in the background (default **1 minute**, clamped 1-30 min via `GITHUB_PROJECTS_SYNC_POLL_MS`). That poll is the near-real-time path for **user-owned** Projects. With a GitHub App installed on an **organization** that owns the Project, live `projects_v2_item` webhooks also drive pulls (handler is ready; GitHub only emits those events for org-owned Projects). Manual Sync always works. The toolbar shows last success, in-progress, and last error. Set `GITHUB_PROJECTS_SYNC_POLL_ENABLED=0` on the Bridge to disable background poll.
8. **Conflict policy:** last-write-wins. Pull overwrites mapped card fields from GitHub; push-on-edit overwrites those fields on GitHub. Matching is by stored Project item id.
9. **Card sheet:** Linked Issue/PR cards group GitHub Project fields, description, labels, Issue comments, and Issue **timeline activity** (labels, assignees, Project moves, close/reopen, and similar) under a GitHub section. Prompt, attachments, subagent, subtasks, and local comments stay under GodMode. Description supports Edit / Preview for Markdown.

### Card lifecycle (linked boards)

| Action | Local card | Project item | Issue / PR |
|--------|------------|--------------|------------|
| Create as Draft | Created | Draft item added | None until converted on GitHub |
| Create as Issue | Created | Item added for new Issue | Created in chosen repo |
| Create local only | Created | None | None |
| Archive | Removed | Archived | Kept |
| Remove from Project | Removed | Deleted | Kept |
| Sync after GH archive/remove | Removed | (already gone) | Kept |

Field map: title, description, column↔Status, **due/target date** (not start), **start date** (distinct), priority (P0–P3 ↔ Project Priority), labels, assignees, milestone, **iteration** (badge + edit when the Project has Iteration), **estimate** / number (named Estimate, Story Points, etc.), **text/note** custom fields (named Text, Notes, etc.). Fields sync when present and mapped by name. Agent assignment and prompts stay local. Card face fields (priority, labels, assignees, due, milestone, iteration, estimate) can be shown or hidden per board in the **Card fields** menu. Saving a card keeps GitHub sync metadata in `context_json` alongside attachments. You cannot sync a Project your token cannot access.

### Migration for existing boards

Boards created before multi-column sync get a default five-column `columns_json` on next open (schema backfill v19). Linked boards: run **Sync GitHub** once so columns match Status options and cards remap. Hide/WIP set after Sync stick on later pulls.

Kanban parity epic #259 (Done); GitHub App epic #266 (Done). Board filter / search / sort (#276), lifecycle polish (#278), swimlanes / group-by (#274), and Project field parity leftovers (#277) are shipped. Issue comments + soft sync (#293) and Issue timeline activity in the card sheet are shipped. Full GitHub issue UI parity (review threads, richer Project status from/to labels when the API omits them) is not claimed by those epics.

## Route

`/tasks`

The Automations tab in Chat shows the agent board ([[automations]]).
