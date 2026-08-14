# Release submissions (GitHub Near proof)

Ship-from-GodMode for one release target: **GitHub Releases**, using Vault GitHub Connect.

## Loop

1. Connect GitHub under Vault → Integrations (publisher credentials).
2. In Intelligence (code access): prepare notes/tag with `github_release_prepare`.
3. Confirm `github_release_create` (draft by default). Deploy Authority and coding kill switches apply. Create/publish tools are never auto-approved.
4. Track status and download metrics on **Releases** (`/releases`). Refresh pulls live GitHub metrics.
5. Optional: `github_release_publish` to flip a draft live (also confirm-gated).
6. Support inbound: **Create follow-up task** on a ticket (or `promote_support_to_card`) opens a Kanban card tagged `auto` / `support` / `release-followup` so a coding agent can ship a fix within Authority.

## What this is not

- Admin → Updates (consumer install poller) is separate.
- npm, Chrome Web Store, Play, App Store consoles belong under the publisher/store connector pattern (#446), not this Near proof.
- Full Attention approve UX remains on #418; confirm dialogs + notifications cover the gate today.

## Connector pattern handoff (#446)

Reusable shape proven here:

1. Auth: OAuth or vendor CLI secret into Vault (fixed secret id or Connect card).
2. Tools: prepare (stage) → submit (confirm + never auto-approve) → list/metrics.
3. Authority: kill switches + irreversible confirm policy.
4. Page: status/metrics surface distinct from unrelated Admin views.
5. Inbound: Support (or similar) → Kanban card for follow-up ship work.

Further store/network targets should install as Marketplace or Intelligence-built plugins that follow this pattern, not grow core identity.
