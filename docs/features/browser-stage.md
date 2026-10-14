# Browser stage

Governed Agent browser reach with a human-visible stage (watch / pause / take over). Part of epic [#374](https://github.com/ReBoticsAI/GodMode/issues/374).

## Surface

- **Primary dogfood:** Windows Electron Local (`godmode-windows-desktop-*.exe` from GitHub Releases), not the Vite/dev Bridge.
- **Runtime:** Bridge launches Playwright Chromium with a dedicated `user-data-dir` under `{PLATFORM_DATA_DIR}/browser-profiles/<sessionId>` (on Windows: `%APPDATA%\GodMode\data\browser-profiles\...`).
- **Not** Docker/Firecracker on Local. Cloud SaaS browser sessions are gated until disposable jobs (#780) or OS connectors (#339).

## Agent tools

| Tool | Role |
|------|------|
| `browser_session_create` | Start session; opens Browser stage UI |
| `browser_session_list` / `browser_session_close` | Lifecycle |
| `browser_navigate` / `browser_click` / `browser_type` / `browser_select` | Actions |
| `browser_screenshot` / `browser_snapshot` | Observe |
| `browser_session_pause` / `takeover` / `resume` | Human control |

Mutating tools use `mode: confirm` like coding writes. Allowlists (`allowHosts`) and `maxSteps` enforce bounds.

## REST / WebSocket

- `GET /api/ai/browser/status`
- `GET|POST /api/ai/browser/sessions`
- `POST .../navigate|click|type|select|screenshot|snapshot|mode`
- `DELETE /api/ai/browser/sessions/:id`
- `GET .../frame` (JPEG for stage poll)
- `WS /ws/browser?session=<id>` (frame push)

## Plugin host contract (#854)

Plugins must **not** embed survey-site scrapers in Core. A survey (or similar) plugin should:

1. Call host tools above (or HTTP browser routes with the same auth/tenant) for navigation and form fill.
2. Keep site packs, credentials, and completion rules in the **plugin** (Vault secrets for logins).
3. Prefer official APIs when a vendor offers them; browser is the escape hatch.

Example flow (plugin skill text): create session with `allowHosts` for target sites → snapshot → click/type → screenshot for audit → close session.

## Dogfood (Windows Local)

1. Install latest `godmode-windows-desktop-*.exe` nightly after this feature merges.
2. Open Graph → Browser (or wait for `browser_session_create` to open the stage).
3. Ask Intelligence: create a browser session, open a public practice form, fill fields while you watch.
4. Use Pause / Take over / Resume / Stop in the stage window.

## Skill

Bootstrap skill id: `browser-use` (`apps/bridge/data/ai/skills-bootstrap/browser-use/SKILL.md`).
