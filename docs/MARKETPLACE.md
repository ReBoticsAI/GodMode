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

**Marketplace → Unofficial** is the single place to install plugins for your workspace:

1. **Add local plugin folder** — paste the path to a cloned repo (must contain `godmode.plugin.json`). GodMode validates the manifest, builds if needed, registers the plugin with Bridge, and installs it for the current workspace.
2. **Add catalog source** — third-party catalog URLs (remote or local `file://` index).
3. **Plugins on this machine** — install or uninstall discovered plugins without leaving the UI.

Use **Marketplace → Installed** to review workspace plugins, uninstall, or remove registered local paths.

Each unofficial catalog must expose a `catalog/index.json` compatible with the official schema.

You can point at a **local file catalog** (never leaves your machine):

```
file:///C:/Users/you/my-catalog/catalog/index.json
```

## Private plugins

Three supported paths for plugins that are not public on GitHub:

### 1. Local folder in the UI (recommended)

Clone the repo anywhere on disk, then **Marketplace → Unofficial → Add local plugin folder**. No terminal or env var required.

### 2. Local file catalog + `pluginLocalPath`

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

### 3. `GITHUB_TOKEN` for private HTTPS repos

Set in `apps/bridge/.env`:

```
GITHUB_TOKEN=ghp_...
```

Catalog entries with `installType: "plugin"` and `pluginRepo: https://github.com/you/private-plugin.git` clone using token auth.

### 4. Advanced: `GODMODE_PLUGIN_PATH`

For automation or non-standard layouts, set in `apps/bridge/.env`:

```
GODMODE_PLUGIN_PATH=C:\dev\godmode-plugin-mine
```

Restart Bridge, then install from **Marketplace → Unofficial** under **Plugins on this machine**.

Intelligence tools `scaffold_plugin` → `build_plugin` → `install_plugin` use the **same** activate path as Unofficial (persist path + runtime load + tenant install). Scaffolds live under the coding root at `plugins/<id>/` (on hub: under the tenant workspace on `/data`). No restart required for tools / `tenant:install`.

## Docker hub notes

**Intelligence-authored plugins** persist under `/data/tenant-workspaces/<tenantId>/plugins/<id>` (already on `PLATFORM_DATA_DIR`). No extra volume is required for that pipeline.

**Operator-dropped plugins** (paste a folder in Unofficial): Bridge runs **inside** the container. Paths must be visible there (for example `/plugins/my-plugin`), not a Windows `C:\...` path on your laptop.

Optional host mount for shared operator plugins:

```yaml
volumes:
  - ./plugins:/plugins
environment:
  # optional override; Intelligence defaults to tenant-workspace plugins/
  - GODMODE_PLUGIN_SCAFFOLD_DIR=/plugins
```

When a plugin's `bridge.js` externalizes `@godmode/plugin-api` / `@godmode/plugin-host`, Bridge rewrites those `node_modules` entries to the image's built packages before load. You do not need a sibling GodMode checkout inside the container for those two packages.

Hardware-bound plugins (desktop apps, devices) still need the **Connector** on the machine that runs that software — see `apps/connector/README.md`.

## Submitting to Official

See [CONTRIBUTING.md](https://github.com/ReBoticsAI/GodMode-Marketplace/blob/main/CONTRIBUTING.md) in the marketplace repo. Intelligence can generate a manifest with `prepare_marketplace_submission`.

## Install types

| Type | Behavior |
|------|----------|
| `clone` | Downloads `bundle.json` and imports via portability |
| `plugin` | Clones `pluginRepo` (or uses `pluginLocalPath`) and registers with Bridge |

Live access to resources is **Shared only**, not sold through Marketplace.

Full walkthrough: [VERIFICATION.md](./VERIFICATION.md)
