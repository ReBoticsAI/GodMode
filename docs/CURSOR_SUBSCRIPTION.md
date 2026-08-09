# Cursor subscription (Intelligence)

Run Intelligence chats on **Cursor-hosted models** billed to your Cursor plan, with **GodMode tools** (wiki, memory, coding, plugins) in the loop.

This is the `cursor_cloud` backend (`@cursor/sdk`). It is **not** the `cursor` CLI contractor backend, and it is not a 1:1 import of Cursor IDE chat history.

## Doctrine: GodMode UI first

**Product surfaces** for day-to-day Intelligence config:

| Need | Where in GodMode |
|------|------------------|
| Workspace / project instructions | Knowledge → **Rules** (and Skills). Create/edit there. |
| Event and schedule automations | Agents → Automations → **Hooks** (SQLite + Bridge dispatcher) |
| MCP servers | Agents → Pipeline → **MCP** node (list, enable/disable, SDK pass-through) |

Coding-root `.cursor/*` (rules, skills, `mcp.json`, `AGENTS.md`) remains an **optional one-way import / discovery** source for repos that already use Cursor. GodMode does **not** write back to `.cursor` in v1.

**Automations Hooks ≠ Cursor IDE `hooks.json`.** Different executors. Bridge does not advertise or run Cursor hooks from disk; manage automations only in GodMode UI.

## Quick checklist

1. In the [Cursor dashboard](https://cursor.com/dashboard) → **Integrations**, create a **User API key**.
2. In GodMode: **Vault → Cursor subscription** → paste the key → **Connect**.
3. Open the Intelligence model picker → **Cursor** → choose **Auto (Cursor picks)** (recommended) or a named model.
4. Chat as usual: tools run in GodMode; model tokens bill to Cursor.

You can also use **Vault → Use Cursor for Intelligence**, which selects `cursor_cloud` and applies the matching harness profile.

## Auto vs named models

| Intent | Picker choice | SDK payload |
|--------|---------------|-------------|
| Same as Cursor IDE Auto | **Auto (Cursor picks)** | `{ id: "auto" }` |
| Always a Grok slug | Named id from `Cursor.models.list()` | `{ id: "<grok-id>" }` |
| Always Composer | e.g. `composer-2.5` | `{ id: "composer-2.5" }` |

**Default: Auto.** Cursor chooses among its Auto-bucket pool (on individual/team plans that often includes Composer and Grok). You only pin a named id when you need a deterministic model.

GodMode does **not** hard-code Grok's slug: the catalog discovers ids via the SDK and formats labels when the API has no display name.

## Harness profiles

Picker model id selects a Cursor family harness (see [LOCAL_LLM.md](./LOCAL_LLM.md)):

| Model id | Profile |
|----------|---------|
| `auto` / empty | `cursor-auto` |
| `/composer…/` | `cursor-composer` |
| `/grok/i` | `cursor-grok` |
| other Cursor ids | `cursor` (fallback) |

Changing the picker model updates `send({ model, mode })` on an existing in-memory handle. After Bridge restart, `cursor_cloud` calls `Agent.resume("godmode-<chatId>")` before `Agent.create`, so native SDK conversation (including tool turns) survives when the local agent store still has the agent. The rolling transcript appendix is a **fallback** only when create is used (new chat or resume miss). It is skipped when resume or an in-memory handle continues the conversation.

GodMode identity stays in `<!-- godmode-system -->` injection: `@cursor/sdk` `AgentOptions` has no system/instructions field for the main agent, so injection remains the highest-fidelity channel (decision: keep injection; do not wait for a native system API). Project rules continue via `settingSources: ["project"]` when `.cursor/` exists (not a Knowledge mirror). Never enables `user` / `team` / `all` setting sources on Bridge/SaaS.


For **local / provider** backends (not `cursor_cloud`), Bridge imports the coding root's `AGENTS.md`, optional `.cursor/AGENTS.md`, `.cursor/rules/**/*.mdc`, and `.cursor/skills/*/SKILL.md` into the tenant Knowledge DB (ids prefixed `cursor-ws-…`, source `__cursor_workspace__`) so Gemma and other local chats see the same repo instructions. Import is **non-destructive**: rows you edit in Knowledge keep your body (`user_edited`). Prefer Knowledge CRUD for ongoing edits; use **Import from coding root** when you want a fresh bootstrap from disk. `cursor_cloud` skips that import to avoid double-injecting rules already loaded by the SDK.

When the coding root (`agent.config.workspace` or Bridge `repoRoot`) contains a `.cursor/` directory, `Agent.create` / `resume` sets `local.settingSources: ["project"]` so Cursor **project** rules load from disk. Set **Coding workspace** on the Backend node for `cursor_cloud` (same idea as CLI working directory).

On hub/client Linux, `CURSOR_SDK_SANDBOX=required` (default) enables SDK `sandboxOptions` so Cursor **built-in** Shell/FS stay under the tenant coding root. GodMode tools still go through Bridge Layers 1–4. Bridge may create `{cwd}/.cursor/sandbox.json` (network allowlist) if missing; it never writes `~/.cursor/sandbox.json`. Set `CURSOR_SDK_SANDBOX=off` only for emergency debug.

## System prompt shape (Cursor parity)

GodMode assembles the Intelligence system prompt in a Cursor-like heading order (`HARNESS_VERSION` `cursor-parity-v5`, prompt-flow v4):

1. Identity: agent profile, user context, base prompt
2. Early harness: communication, tool-calling policy, search/reading, citations
3. Environment: platform / page context (git discovery)
4. MCP / external tools (`<godmode_mcp>` when `.cursor/mcp.json` is present)
5. Rules and skills
6. GodMode-only blocks (labeled): `<godmode_memory>`, `<godmode_wiki>`, `<godmode_capabilities>`, `<godmode_user>`
7. Tools and @mentions
8. Late harness: plugin tiers, tasks loop, coding agent contract (when code access), chat mode

Before assembly, Bridge enriches `platformContext` with a compact **git snapshot** of the coding root (`agent.config.workspace` or tenant/repo root): branch, dirty file count, and ahead/behind when an upstream exists. Soft-fails outside a git work tree. Rendered as `Git: Branch: … | clean|dirty: N | ahead X / behind Y` in the Page Context section (visible in `/api/ai/inspect` when a pathname is supplied).

When the coding root has `.cursor/mcp.json`, Bridge also attaches MCP discovery into the dedicated **MCP** prompt section (and the Builder MCP node). Server names and transport are listed; `env` values and `headers` are never included.

`codebase_search` uses the **code** embedding profile when indexed (AST chunks + hybrid grep); otherwise grep-only. See [AGENT_MEMORY.md](./AGENT_MEMORY.md).

For **`cursor_cloud`**, project MCP is available in two ways:

1. **Ambient** via `local.settingSources: ["project"]` when `.cursor/` exists (SDK loads `.cursor/mcp.json`).
2. **Inline** `mcpServers` from the same file when `agent.config.mcpFromWorkspace` is enabled (default **on** for non-SaaS, **off** on SaaS). Toggle and per-server enable/disable live on Agents → Pipeline → **MCP**. Inline servers are passed on `Agent.create` / `resume` and each `send` (SDK does not persist inline MCP across resume). Cap: 8 servers. OAuth MCP that needs an interactive login only works if already signed in from the Cursor app.

Local/provider backends still see discovery only; Bridge does not spawn MCP processes for those backends. GodMode native tools remain separate from Cursor MCP.

Blind IDE vs GodMode scoring prompts live in [CURSOR_PARITY_EVAL.md](./CURSOR_PARITY_EVAL.md).

`cursor_cloud` delivers this assembled text via `<!-- godmode-system -->` injection into the user prompt. That is intentional: the SDK has no main-agent system-role field, so injection is the durable contract (not a temporary workaround awaiting replacement). Saved prompt-flow configs migrate section **order** to this layout while preserving each section's enabled flag.

Per turn, `cursor_cloud` also injects `<!-- godmode-reminders -->` (mode, optional abort note, coding workspace). When history compaction drops earlier turns, Bridge appends a short `<godmode_compaction>` scratchpad to the system prompt (and still enqueues episodic distill). If the in-memory SDK agent is recreated because model/mode/MCP/system fingerprint changed, the rolling transcript appendix is included again even when `Agent.resume` succeeds.

Intelligence chat mode maps to the SDK as follows:

| GodMode mode | SDK `Agent.create({ mode })` | Notes |
|--------------|------------------------------|-------|
| Agent | `agent` | Full tool loop |
| Plan | `plan` | Native Cursor plan mode (plus GodMode read-only tool filter) |
| Ask | `agent` | No SDK ask mode; GodMode strips tools and uses the ask harness block |

Optional `agent.config.modelParams` (e.g. `{ "fast": true }`) is passed as SDK `model.params: [{ id, value }]` on create/resume and on each `send`.

## Coding apply path

When Intelligence asks to run `edit_file`, `write_file`, or `apply_patch` and confirmation is required, Bridge dry-runs a unified diff against the coding-root file and sends it on `tool_confirm_required` as `previewDiff` (or `previewError`). The chat confirm card shows that preview **before** Approve/Deny. Approve still runs the normal executor (disk write unchanged).

After a successful TypeScript/TSX write, the tool result also includes `verification` from a bounded `tsc --noEmit` (skipped for non-TS paths or when no `tsconfig` is present). The chat tool card shows a Diagnostics block so the model sees type errors in the same turn without a separate `read_diagnostics` call.

## Coding workspace UI

Sidebar **Coding** (`/coding`) is a human file tree, Git status/diff panel, and editor over the same sandboxed coding root agents use (`resolveCodingRoot`: local repo, or hub/SaaS `tenant-workspaces/<tenantId>/`, or the agent's **Coding workspace** path). Creates, saves, renames, and deletes go through `/api/ai/coding/*` and are audited. Paths cannot escape the root. Agents ship with structured `git_*` tools (confirm on commit/push; no force-push).

On SaaS, Coding UI and agent `codeAccess` are **on by default** (#178). Set `PLATFORM_SAAS_ALLOW_CODE_ACCESS=false` to disable. Interactive shared PTY and Layer 3/4 sandboxes apply when coding is enabled (see [SECURITY.md](./SECURITY.md)).

## CLI login ≠ SDK billing key

`cursor-agent login` authenticates the **CLI** (`cursor` backend / contractors). Intelligence **Cursor Cloud** requires the dashboard **User API key** in Vault (or `CURSOR_API_KEY`). CLI login alone does not enable `cursor_cloud`.

## Related

- [LOCAL_LLM.md](./LOCAL_LLM.md): harness profiles and local llama-server
- [CURSOR_PARITY_EVAL.md](./CURSOR_PARITY_EVAL.md): blind eval prompts
- [VERIFICATION.md](./VERIFICATION.md): UI checklists (Knowledge, MCP, Automations)
- Epic [#135](https://github.com/ReBoticsAI/GodMode/issues/135): Cursor conventions in GodMode UI
