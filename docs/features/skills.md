---
slug: skills
title: "Skills"
section: "Knowledge and memory"
location: "Chat → Knowledge → Skills"
summary: "Reusable workflows or playbooks the agent can invoke."
---
# Skills

![skills in GodMode](/features/skills.png)


Skills are reusable workflows or playbooks. Quality gates apply on create so low-quality skills do not silently ship.

Import sources (Knowledge badges):

- **Import from coding root:** coding-root `.cursor/skills/*/SKILL.md` (source `__cursor_workspace__`).
- **Import Cursor user:** host `~/.cursor/skills/*/SKILL.md` (source `__cursor_user__`). Local installations only; not `skills-cursor` or plugin-cache skills. Skills index lands in the assembled prompt; full bodies load via `use_skill`. Same Knowledge path is used for `cursor_cloud` (no SDK user settingSources).
