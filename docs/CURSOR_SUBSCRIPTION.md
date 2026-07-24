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

Changing the picker model recreates the cached SDK agent for that chat (model + system prompt + project-settings fingerprint), so mid-thread switches take effect. A rolling transcript appendix is prepended for continuity: prior user/assistant text plus truncated tool calls and tool results (char-budgeted). This is not a full SDK-native conversation resume or Gemma-local history replay; it keeps multi-turn tool context after fingerprint resets.

When the coding root (`agent.config.workspace` or Bridge `repoRoot`) contains a `.cursor/` directory, `Agent.create` sets `local.settingSources: ["project"]` so Cursor **project** rules load from disk. GodMode Identity still comes from `<!-- godmode-system -->` injection; this does not mirror `.cursor/rules` into Knowledge and never enables `user` / `team` / `all` setting sources (host Cursor prefs stay off on Bridge/SaaS).

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

`cursor_cloud` still delivers this assembled text via `<!-- godmode-system -->` injection into the user prompt (SDK native system-role replacement is a later #71 slice). Saved prompt-flow configs migrate section **order** to this layout while preserving each section's enabled flag.

Intelligence chat mode maps to the SDK as follows:

| GodMode mode | SDK `Agent.create({ mode })` | Notes |
|--------------|------------------------------|-------|
| Agent | `agent` | Full tool loop |
| Plan | `plan` | Native Cursor plan mode (plus GodMode read-only tool filter) |
| Ask | `agent` | No SDK ask mode; GodMode strips tools and uses the ask harness block |

Optional `agent.config.modelParams` (e.g. `{ "fast": true }`) is passed as SDK `model.params: [{ id, value }]` on create. Param and mode changes recreate the cached SDK agent (same fingerprint path as model/system/`settingSources`).

## CLI login ≠ SDK billing key

`cursor-agent login` authenticates the **CLI** (`cursor` backend / contractors). Intelligence **Cursor Cloud** requires the dashboard **User API key** in Vault (or `CURSOR_API_KEY`). CLI login alone does not enable `cursor_cloud`.

## Related

- [LOCAL_LLM.md](./LOCAL_LLM.md) — local Gemma + harness table
- [CONFIGURATION.md](./CONFIGURATION.md) — env vars including `CURSOR_API_KEY`
- Vault UI: Cursor subscription card
