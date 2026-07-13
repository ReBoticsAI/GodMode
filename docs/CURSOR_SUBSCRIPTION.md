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

Changing the picker model recreates the cached SDK agent for that chat (model + system prompt fingerprint), so mid-thread switches take effect. A short rolling user/assistant transcript is appended for continuity — not a full local tool-history replay like Gemma.

## CLI login ≠ SDK billing key

`cursor-agent login` authenticates the **CLI** (`cursor` backend / contractors). Intelligence **Cursor Cloud** requires the dashboard **User API key** in Vault (or `CURSOR_API_KEY`). CLI login alone does not enable `cursor_cloud`.

## Related

- [LOCAL_LLM.md](./LOCAL_LLM.md) — local Gemma + harness table
- [CONFIGURATION.md](./CONFIGURATION.md) — env vars including `CURSOR_API_KEY`
- Vault UI: Cursor subscription card
