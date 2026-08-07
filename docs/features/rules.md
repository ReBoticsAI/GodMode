---
slug: rules
title: "Rules"
section: "Knowledge and memory"
location: "Chat → Knowledge → Rules"
summary: "Behavior constraints attached to the active agent."
---
# Rules

![rules in GodMode](/features/rules.png)


Rules are behavior constraints attached to the active agent. They shape how the agent responds and which actions it prefers.

Import sources (Knowledge badges):

- **Import from coding root:** repo `AGENTS.md` and coding-root `.cursor/rules` (source `__cursor_workspace__`). Used for local/provider backends; `cursor_cloud` relies on SDK `settingSources: ["project"]` for those files instead.
- **Import Cursor user:** host `~/.cursor/rules` (source `__cursor_user__`). Available on local installations only (not SaaS). Injected via `assemblePrompt` for every backend, including `cursor_cloud` through `<!-- godmode-system -->`. Does not enable SDK `settingSources: ["user"]`.
