# Publisher / store console connector pattern

Channel and store consoles stay vendor plugins or Official packs. Core owns media tools, pages, schedules, Authority, and this **catalog** so Intelligence can install a connector instead of growing vendor consoles in public GodMode.

GitHub Releases is the in-tree **store** Near proof ([release-submission](release-submission.md)). A **channel** publish loop belongs on the media epic and must register through the same API. Do not add YouTube, npm, Chrome Web Store, Play, or App Store identity to Core.

## Pattern

1. **Auth**: OAuth App, vendor CLI token, or Vault Connect card (GitHub).
2. **Vault**: store credentials under a stable secret id or Connect card. Never commit secrets.
3. **Tools**: prepare (stage) → submit (confirm, never auto-approve for irreversible publish) → optional publish → list/metrics pull.
4. **Authority**: coding kill switch and/or deploy Authority. Notify on success/failure (Attention / Notifications).
5. **Page**: Structure page kind or fixed route for status/metrics. Do not overload Admin Updates.
6. **Teardown**: disconnect clears the vault token.
7. **Catalog**: call `api.publisherConnectors.register` from the plugin Bridge entry so Chat can `list_publisher_connectors`.

Official packs still meet [OFFICIAL_CONNECTORS.md](../OFFICIAL_CONNECTORS.md) (refresh, scopes, webhooks, grants, Cloud pins).

## Core catalog

| Id | Kind | Source | Status |
|----|------|--------|--------|
| `github-releases` | store | Core | Vault GitHub Connect, `github_release_*`, `/releases` |

Channel connectors have no Core row. A channel plugin registers its own id (for example `kind: "channel"`) when that loop ships.

## Plugin register

```typescript
api.publisherConnectors.register([
  {
    id: "example-channel",
    title: "Example Channel",
    description: "Publish one post and pull metrics.",
    kind: "channel",
    source: "plugin",
    installHint: "Install Example Channel from Marketplace, then connect in Vault.",
    vaultSecretId: "example-channel-token",
    tools: {
      prepare: "example_prepare",
      submit: "example_publish",
      list: "example_metrics",
    },
    neverAutoApprove: ["example_publish"],
    pageKind: "example-console",
    pagePath: "/example-channel",
  },
]);
```

`pluginId` is stamped by the host. Core ids such as `github-releases` are reserved.

Intelligence: `list_publisher_connectors` (read-only). Humans: Releases page catalog plus Marketplace for plugin-backed rows.

## Near consumers

| Loop | Target | How it uses this pattern |
|------|--------|--------------------------|
| Store proof | GitHub Releases | Core row `github-releases` |
| Channel proof | One publisher channel | Plugin `publisherConnectors.register`; not Core |

Further networks and app stores stay Marketplace or Intelligence-built plugins, not core identity.
