# Cursor subscription (Intelligence)

Run Intelligence chats on **Cursor-hosted models** billed to your Cursor plan, with **GodMode tools** (wiki, memory, coding, plugins) in the loop.

This is the `cursor_cloud` backend (`@cursor/sdk`). It is **not** the `cursor` CLI contractor backend, and it is not a 1:1 import of Cursor IDE chat history.

## Quick checklist

1. In the [Cursor dashboard](https://cursor.com/dashboard) → **Integrations**, create a **User API key**.
2. In GodMode: **Vault → Cursor subscription** → paste the key → **Connect**.
3. Open the Intelligence model picker → **Cursor** → choose **Auto (Cursor picks)** (recommended) or a named model.
4. Chat as usual — tools run in GodMode; model tokens bill to Cursor.

You can also use **Vault → Use Cursor for Intelligence**, which selects `cursor_cloud` and applies the matching harness profile.

## Auto vs named models

| Intent | Picker choice | SDK payload |
|--------|---------------|-------------|
| Same as Cursor IDE Auto | **Auto (Cursor picks)** | `{ id: "auto" }` |
| Always a Grok slug | Named id from `Cursor.models.list()` | `{ id: "<grok-id>" }` |
| Always Composer | e.g. `composer-2.5` | `{ id: "composer-2.5" }` |

**Default: Auto.** Cursor chooses among its Auto-bucket pool (on individual/team plans that often includes Composer and Grok). You only pin a named id when you need a deterministic model.

GodMode does **not** hard-code Grok’s slug — the catalog discovers ids via the SDK and formats labels when the API has no display name.

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

When the coding root (`agent.config.workspace` or Bridge `repoRoot`) contains a `.cursor/` directory, `Agent.create` / `resume` sets `local.settingSources: ["project"]` so Cursor **project** rules load from disk.

## System prompt shape (Cursor parity)

GodMode assembles the Intelligence system prompt in a Cursor-like heading order (`HARNESS_VERSION` `cursor-parity-v3`):

1. Identity: agent profile, user context, base prompt
2. Early harness: communication, tool-calling policy, search/reading, citations
3. Environment: platform / page context
4. Rules and skills
5. GodMode-only blocks (labeled): `<godmode_memory>`, `<godmode_wiki>`, `<godmode_capabilities>`, `<godmode_user>`
6. Tools and @mentions
7. Late harness: plugin tiers, tasks loop, coding agent contract (when code access), chat mode

Before assembly, Bridge enriches `platformContext` with a compact **git snapshot** of the coding root (`agent.config.workspace` or tenant/repo root): branch, dirty file count, and ahead/behind when an upstream exists. Soft-fails outside a git work tree. Rendered as `Git: Branch: … | clean|dirty: N | ahead X / behind Y` in the Page Context section (visible in `/api/ai/inspect` when a pathname is supplied).

`cursor_cloud` delivers this assembled text via `<!-- godmode-system -->` injection into the user prompt. That is intentional: the SDK has no main-agent system-role field, so injection is the durable contract (not a temporary workaround awaiting replacement). Saved prompt-flow configs migrate section **order** to this layout while preserving each section's enabled flag.

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

## CLI login ≠ SDK billing key

`cursor-agent login` authenticates the **CLI** (`cursor` backend / contractors). Intelligence **Cursor Cloud** requires the dashboard **User API key** in Vault (or `CURSOR_API_KEY`). CLI login alone does not enable `cursor_cloud`.

## Related

- [LOCAL_LLM.md](./LOCAL_LLM.md) — local Gemma + harness table
- [CONFIGURATION.md](./CONFIGURATION.md) — env vars including `CURSOR_API_KEY`
- Vault UI: Cursor subscription card
