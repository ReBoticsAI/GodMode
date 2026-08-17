# Release submissions (GitHub Near proof)

Ship-from-GodMode for one release target: **GitHub Releases**, using Vault GitHub Connect.

## Loop

1. Connect GitHub under Vault → Integrations (publisher credentials). The App needs **Contents write** so draft Releases can be created. After permission upgrades, accept on the install and use Reconnect / update permissions.
2. In Intelligence (code access): clone into a folder if needed (`git_clone` retargets coding workspace), or `coding_workspace_set` to the nested checkout. Then prepare notes/tag with `github_release_prepare`.
3. Confirm `github_release_create` (draft by default). Deploy Authority and coding kill switches apply. Create/publish tools are never auto-approved.
4. Track status and download metrics on **Releases** (`/releases`). Refresh pulls live GitHub metrics. If create fails with `Resource not accessible by integration`, Attention and `/releases` point back to Vault reconnect with Contents write.
5. Optional: `github_release_publish` to flip a draft live (also confirm-gated).
6. Support inbound: **Create follow-up task** on a ticket (or `promote_support_to_card`) opens a Kanban card tagged `auto` / `support` / `release-followup` so a coding agent can ship a fix within Authority.

## GitHub App permissions

Draft Releases need **Repository permissions → Contents → Read and write** on the GodMode Cloud GitHub App. After changing App permissions on github.com, each install must **Accept** the new permissions. In GodMode: Vault → Integrations → **Reconnect / update permissions** (or Review App install).

If create fails with `Resource not accessible by integration`, Attention and `/releases` point back to Vault Integrations with a Contents write reconnect message. Code cannot flip live App settings; the App owner must grant Contents write first.

Nested clones: `git_clone` sets coding workspace to the clone folder. Use `coding_workspace_set` / `coding_workspace_clear` if you need to retarget remotes without recloning.

## What this is not

- Admin → Updates (consumer install poller) is separate.
- npm, Chrome Web Store, Play, App Store consoles belong under the publisher/store connector pattern ([publisher-store-connector-pattern](publisher-store-connector-pattern.md)), not this Near proof.
- Full Attention approve UX remains on #418; confirm dialogs + notifications cover the gate today.

## Connector pattern (#446)

Reusable catalog shape:

1. Auth: OAuth or vendor CLI secret into Vault (fixed secret id or Connect card).
2. Tools: prepare (stage) → submit (confirm + never auto-approve) → list/metrics.
3. Authority: kill switches + irreversible confirm policy.
4. Page: status/metrics surface distinct from unrelated Admin views.
5. Catalog: `api.publisherConnectors.register` so `list_publisher_connectors` can install rather than browse.

GitHub Releases is the Core store row (`github-releases`). Further store/network targets register as Marketplace or Intelligence-built plugins. See [publisher-store-connector-pattern](publisher-store-connector-pattern.md).

