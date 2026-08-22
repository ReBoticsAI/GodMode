---
slug: skills
title: "Skills"
section: "Knowledge and memory"
location: "Chat → Knowledge → Skills"
summary: "Reusable playbooks the agent can invoke."
---
# Skills

![skills in GodMode](/features/skills.png)


Skills are reusable playbooks (instruction bundles), not Automations workflows. Quality gates apply on create so low-quality skills do not silently ship.

**Skills vs Workflows:** Skills are playbooks the agent loads with `use_skill`. Workflows (Agents → Automations → Workflows) are executable graphs that orchestrate skills and tools (for example the seeded Scaffold domain plugin workflow). Do not call Skills "workflows."

Import sources (Knowledge badges):

- **Import from coding root:** coding-root `.cursor/skills/*/SKILL.md` (source `__cursor_workspace__`).
