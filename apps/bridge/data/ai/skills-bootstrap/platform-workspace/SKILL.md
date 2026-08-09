---
name: platform-workspace
description: Build basic workspace content with native tools only (wiki, StructureNode shells, pages, agents, tasks). No plugins.
tools: ["list_object_types", "list_records", "create_record", "run_record_action", "create_department", "create_division", "create_page", "create_agent", "create_wiki_page", "update_wiki_page", "list_wiki_pages", "read_wiki_page", "todo_write", "create_project_card", "list_structure"]
---
Use for everyday workspace setup. Stay in native tools; do not scaffold plugins unless the user needs integration or API behavior.

**Do here (Tier 1):**
1. `read_wiki_page` / `list_wiki_pages` when the user asks how something works.
2. Structure shells: prefer `create_record` with `objectType: StructureNode`; department/division/page tools are convenience wrappers over the same kernel path.
3. `list_object_types` / `use_skill('object-types')` for existing shapes. Defining a new ObjectType is Tier 2 (`use_skill('plugin-authoring')`).
4. `create_agent` for specialists; link via structure when appropriate.
5. `create_wiki_page` / `update_wiki_page` for guides and notes.
6. Agent chat plans: `todo_write` only (nests under the host Active Work run card). Use `create_project_card` only when the user wants a standing Kanban card outside the current chat run.

**Notes / personal notes / notes-taker:**
- Do **not** stop after an empty department (DepartmentOverview with "No workspaces configured…"). That is not a notes app.
- Prefer wiki pages the user can open and edit (`create_wiki_page`), and/or a division + page with kind `record-list` bound to a Note (or similar) ObjectType so **New** / edit work.
- After Structure changes, `list_structure` and confirm a path the user can open. Optionally create one sample wiki page or record so the surface is not empty.

**When integration/API/hardware is implied:** stop. Call `use_skill('plugin-authoring')` and `scaffold_plugin` instead of bare structure tools.

**One step at a time:** complete one tool call, confirm result, then continue. Prefer short plans (3–5 bullets) before acting.

**Do not:** edit Bridge source or scaffold plugins for wiki-only requests. Do not claim a notes/tips surface is done when only a department shell exists.
