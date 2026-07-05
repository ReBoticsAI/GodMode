---
name: platform-workspace
description: Build basic workspace content with native tools only (wiki, structure shells, pages, agents, tasks) — no plugins
tools: ["create_department", "create_division", "create_page", "create_agent", "create_wiki_page", "update_wiki_page", "list_wiki_pages", "read_wiki_page", "todo_write", "create_project_card", "list_structure"]
---
Use this skill for **everyday workspace setup**. Stay in native tools; do not scaffold plugins unless the user clearly needs integration or API behavior.

**Do here (Tier 1):**
1. `read_wiki_page` / `list_wiki_pages` when the user asks how something works.
2. `create_department` → `create_division` → `create_page` for **non-functional** org labels only (no API/integration implied).
3. `create_agent` for specialists; link via structure when appropriate.
4. `create_wiki_page` / `update_wiki_page` for guides and notes.
5. `todo_write` + `create_project_card` for tasks and automations.

**When integration/API/hardware is implied:** stop — call `use_skill('platform-extension')` and `scaffold_plugin` instead of bare structure tools.

**One step at a time:** complete one tool call, confirm result, then continue. Prefer short plans (3–5 bullets) before acting.

**Do not:** edit Bridge source or scaffold plugins for wiki-only requests.
