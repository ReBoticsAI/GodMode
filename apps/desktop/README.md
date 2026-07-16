# GodMode desktop

Electron shell for local personal installs. It stages the same Bridge + web
runtime used by bare-metal packages, opens a window on loopback, and runs the
update supervisor so **Admin → Updates** can apply signed installers.

## Develop

From the repo root (after `npm install` and building Bridge/web):

```bash
npm run build -w @godmode/bridge
npm run build -w @godmode/web
npm run build -w @godmode/desktop
# Optional: stage a runtime into apps/desktop/resources/runtime
RELEASE_VERSION=v0.1.0 RELEASE_COMMIT=$(git rev-parse HEAD) \
  node scripts/release/package-desktop.mjs
```

For a quicker UI-only loop against `npm run dev`, point the shell at an already
running host by setting `GODMODE_DEV_URL=http://127.0.0.1:5173` (not required
for packaging).

## Package

```bash
RELEASE_VERSION=v0.1.0 RELEASE_COMMIT=<40-char-sha> npm run package:desktop
```

Installers land under `release-out/`. See [docs/RELEASES.md](../../docs/RELEASES.md).
