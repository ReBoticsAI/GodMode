# AI tool vs ObjectType parity inventory

**Rule:** Ship durable capabilities once on the kernel (or a narrow shared Bridge route), then consume them from both UI and agents. See [OBJECTTYPE_KERNEL.md](OBJECTTYPE_KERNEL.md) **UI and agent parity**.

This document is the human index for [`scripts/ai-tool-parity-inventory.json`](../scripts/ai-tool-parity-inventory.json). CI (`npm run audit:kernel:strict` → `audit-ai-tool-parity.mjs`) fails when a new static `AI_TOOL_REGISTRY` tool with `write: true` is added without an inventory entry.

## Classes

| Class | Meaning |
|-------|---------|
| `kernel_generated` | Static name is a cutover alias; executor prefers generated ObjectType / `run_record_action` / `create_record` |
| `protocol_exception` | Documented shared Bridge route; UI and agents share the same handler (not a parallel git/GitHub path) |
| `infra_coding` | Coding-stage filesystem, git, GitHub, terminal, plugin build/install |
| `infra_llm` | Local LLM process control |
| `infra_search` | Search/retrieval writers (reserved; none currently) |
| `legacy_gap` | Known static mutation still awaiting ObjectType / action cutover |

## Reference cutover (#603)

Community Marketplace catalog publish (P1a):

- Web: Marketplace → Sell → **Submit to Community catalog** via
  `MarketplaceCatalog.prepare_submission` / `submit_submission`
- Agents: static `prepare_community_catalog_submission` /
  `submit_community_catalog_submission` are cutover aliases (`kernel_generated`);
  generated tools are `marketplace_catalog_prepare_submission` /
  `marketplace_catalog_submit_submission`
- Shared: `apps/bridge/src/services/marketplace-catalog-submission.ts`

Vault GitHub Connect (P1b):

- Web: Vault → Integrations → **Connect GitHub** via
  `GithubIntegration.status` / `start_connect` / `disconnect`
- Generated tools: `github_integration_status`,
  `github_integration_start_connect`, `github_integration_disconnect`
- OAuth browser callback stays `GET /api/integrations/github/callback`
  (protocol exception)

P2 domain aliases (static name → ObjectType action):

- `create_conversation` → `DirectConversation.start`
- `send_message` → `DirectMessage.send`
- `create_holding` → `FinanceConnection.add_manual`
- `refresh_holdings` → `FinanceConnection.refresh_external`
- `mark_notification_read` → `Notification.mark_read` / `mark_all_read`
- `reply_support_ticket` → `SupportTicket.reply`
- `update_support_ticket` → `SupportTicket.set_status`
- `install_catalog_entry` → `CatalogInstall.install_entry`
- `create_listing` → `MarketplaceListing.publish`

Remaining `legacy_gap` (P2b): `emit_event`, `promote_support_to_card`.

Do **not** use `git_push` / `github_pr_create` as the Community catalog ship path.

## Counts (inventory v1)

Static `write: true` tools are fully listed in the JSON inventory. Prefer that file for the authoritative name list when adding tools.

## Adding a new static write tool

1. Prefer a declared ObjectType action + generated tool instead.
2. If a static writer is unavoidable, add it to `scripts/ai-tool-parity-inventory.json` with class + rationale in the same PR.
3. Run `node scripts/audit-ai-tool-parity.mjs --strict`.
