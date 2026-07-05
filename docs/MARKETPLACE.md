# Marketplace

GodMode installs packs from a **GitHub-backed catalog**, not an in-app credit store.

![Official catalog tab](assets/readme/marketplace.png)

## Official catalog

The live catalog repo: **[github.com/ReBoticsAI/GodMode-Marketplace](https://github.com/ReBoticsAI/GodMode-Marketplace)**

- Default index: `https://raw.githubusercontent.com/ReBoticsAI/GodMode-Marketplace/main/catalog/index.json`
- Override with `MARKETPLACE_OFFICIAL_URL` (Bridge env)
- Local dev auto-detects sibling clone: `../GodMode-Marketplace/catalog/index.json`

Open **Marketplace → Official** to browse and install packs for free.

## Unofficial sources

Add third-party catalog URLs under **Marketplace → Unofficial**. Each source must expose a `catalog/index.json` compatible with the official schema.

You can point at a **local file catalog** (never leaves your machine):

```
file:///C:/Users/you/my-catalog/catalog/index.json
```

## Private plugins

Three supported paths for plugins that are not public on GitHub:

### 1. Local file catalog + `pluginLocalPath`

Add an unofficial catalog URL pointing at a JSON file on disk. Entries can install from an existing directory — no git:

```json
{
  "id": "my-private-plugin",
  "installType": "plugin",
  "title": "My Plugin",
  "pluginLocalPath": "C:/dev/godmode-plugin-mine"
}
```

The directory must contain a valid `godmode.plugin.json`.

### 2. `GITHUB_TOKEN` for private HTTPS repos

Set in `apps/bridge/.env`:

```
GITHUB_TOKEN=ghp_...
```

Catalog entries with `installType: "plugin"` and `pluginRepo: https://github.com/you/private-plugin.git` clone using token auth.

### 3. Manual `GODMODE_PLUGIN_PATH`

Clone the repo yourself, then:

```
GODMODE_PLUGIN_PATH=C:\dev\godmode-plugin-mine
```

Restart Bridge and install under **Settings → Plugins**.

Intelligence tools `scaffold_plugin` and `install_plugin` follow the same install paths.

## Submitting to Official

See [CONTRIBUTING.md](https://github.com/ReBoticsAI/GodMode-Marketplace/blob/main/CONTRIBUTING.md) in the marketplace repo. Intelligence can generate a manifest with `prepare_marketplace_submission`.

## Install types

| Type | Behavior |
|------|----------|
| `clone` | Downloads `bundle.json` and imports via portability |
| `plugin` | Clones `pluginRepo` (or uses `pluginLocalPath`) and registers with Bridge |

Live access to resources is **Shared only**, not sold through Marketplace.

Full walkthrough: [VERIFICATION.md](./VERIFICATION.md)
