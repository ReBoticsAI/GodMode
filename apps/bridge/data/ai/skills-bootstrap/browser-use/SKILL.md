---
name: browser-use
description: Drive a supervised Browser stage session (navigate, click, type) on GodMode Local. Use for forms and long-tail sites when no official API exists. Human can watch and take over.
tools: ["browser_session_create", "browser_session_list", "browser_session_close", "browser_navigate", "browser_click", "browser_type", "browser_select", "browser_screenshot", "browser_snapshot", "browser_session_pause", "browser_session_takeover", "browser_session_resume", "use_skill", "ask_user_choice", "todo_write"]
---
Use when the user needs interactive browser work (fill a form, walk a multi-step site) that `web_search` / `fetch_url` cannot do.

**Hard rules**

- Local desktop only. If tools are missing or Cloud-gated, say so and stop.
- Prefer official APIs / connectors when they exist.
- Set `allowHosts` when the target site is known.
- Call `browser_snapshot` before guessing selectors.
- Do not store passwords in chat; use Vault secrets when a plugin supplies them.
- Survey-site packs and credential flows belong in a **plugin**, not Core prompts.

**Flow**

1. `browser_session_create` (optional `url`, `allowHosts`). The Browser stage opens for the human.
2. `browser_snapshot` → choose selectors.
3. `browser_click` / `browser_type` / `browser_select` / `browser_navigate` as needed.
4. `browser_screenshot` for evidence when useful.
5. `browser_session_close` when done.

If the human takes over, wait for Resume (or ask) before more agent actions.
