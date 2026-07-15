---
name: platform-workspace
description: Build basic workspace content with native tools only (wiki, StructureNode shells, pages, agents, tasks) — no plugins
tools: ["list_object_types", "list_records", "create_record", "run_record_action", "create_department", "create_division", "create_page", "create_agent", "create_wiki_page", "update_wiki_page", "list_wiki_pages", "read_wiki_page", "todo_write", "create_project_card", "list_structure"]
---
Use this skill for **everyday workspace setup**. Stay in native tools; do not scaffold plugins unless the user clearly needs integration or API behavior.

**Do here (Tier 1):**
1. `read_wiki_page` / `list_wiki_pages` when the user asks how something works.
2. Structure shells: prefer `create_record` with
   `objectType: StructureNode`; department/division/page tools are specialized
   UX conveniences whose durable effects dispatch through the same kernel.
3. `list_object_types` / `use_skill('object-types')` discovers existing durable
   shapes. Defining a new ObjectType is Tier 2 plugin work.
4. `create_agent` for specialists; link via structure when appropriate.
5. `create_wiki_page` / `update_wiki_page` for guides and notes.
6. `todo_write` + `create_project_card` for tasks and automations.

**When integration/API/hardware is implied:** stop — call `use_skill('platform-extension')` and `scaffold_plugin` instead of bare structure tools.

**One step at a time:** complete one tool call, confirm result, then continue. Prefer short plans (3–5 bullets) before acting.

**Do not:** edit Bridge source or scaffold plugins for wiki-only requests.
