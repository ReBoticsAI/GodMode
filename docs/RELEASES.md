# Releases and updates

GodMode publishes one tested revision through two channels:

- **nightly** — every green commit on `main`;
- **stable** — an annotated, verified `vX.Y.Z` tag whose package versions and
  changelog entry agree.

Each release contains a canonical manifest, immutable GHCR image digest
(multi-arch `linux/amd64` + `linux/arm64`, built on native runners),
Linux/Windows bare-metal bundles, desktop installers (Windows NSIS, macOS DMG,
Linux AppImage + `.deb`), checksums, SBOMs, provenance, and Sigstore
verification bundles. Tags such as `latest` or a channel name are discovery
aliases only; installation and rollback always record immutable digests and
artifact hashes.

## Installation update records

The core-backed `Release` and `InstallationUpdateState` ObjectTypes expose
release discovery and update policy to platform administrators. The Bridge
poller uses ETag caching and randomized intervals, verifies the publisher
identity and artifact metadata, and creates one `update` notification per
release and administrator.

Open **Admin → Updates** to:

- choose stable or nightly;
- check immediately or enable periodic checks;
- download, defer, or skip a release;
- review compatibility, backup, and readiness state; and
- start an update when a supported host supervisor is present.

Update state and actions remain durable kernel Records/actions. Release notes
are displayed as data and are never interpreted as commands.

## Docker installations

Production compose files consume `GODMODE_IMAGE`, which should include an
immutable digest:

```bash
export GODMODE_IMAGE=ghcr.io/reboticsai/godmode@sha256:<digest>
docker compose -f deploy/docker-compose.client.yml pull
docker compose -f deploy/docker-compose.client.yml up -d
```

The signed host helper verifies the release manifest and image identity before
replacement:

```bash
./scripts/update/godmode-update.sh \
  "https://github.com/ReBoticsAI/GodMode/releases/download/<version>" \
  deploy/docker-compose.client.yml \
  /var/backups/godmode \
  http://127.0.0.1:8080/api/update/readiness \
  deploy/.env.client
```

Bridge never receives the Docker socket. If no authenticated host supervisor is
installed, the web UI presents the verified command for an administrator to run.
SaaS promotion uses the same image digest through a protected GitHub environment
after snapshot rehearsal and readiness checks.

Set `UPDATE_READINESS_TOKEN` in both the host environment and the container env
file. Windows Docker hosts use `scripts/update/godmode-update.ps1` with the same
release URL, compose file, external snapshot root, and readiness URL. Both
helpers stop writers, hash the snapshot, verify the image digest, and restore
the prior image plus snapshot if deep readiness fails.

## Bare-metal installations

Release bundles install under versioned directories. Linux systemd and Windows
service templates point to an atomic `current` runtime. The updater stages the
new bundle beside the active one, verifies its hash/signature, snapshots data,
stops the writer, starts the new version, and commits the pointer only after
readiness succeeds.

Developer clones run with `npm run dev` and intentionally do not self-update.
Do not update a production installation with a mutable `git pull`.

## Desktop installations (Electron)

Non-technical users should install the signed desktop app from GitHub Releases:

| OS | Artifact |
|----|----------|
| Windows | `GodMode-Setup-<version>-windows-x64.exe` (NSIS) |
| macOS | `GodMode-<version>-darwin-arm64.dmg` or `darwin-x64.dmg` |
| Linux | `GodMode-<version>-linux-x64.AppImage` (preferred) or `.deb` |

The Electron shell boots the same Bridge + web runtime as bare-metal, binds only
on loopback, stores SQLite under the OS app data directory, and starts a local
update supervisor so **Admin → Updates** can download, Sigstore-verify, and
apply the matching `installer` artifact.

Set these GitHub Actions secrets for **stable** signed desktop builds:

| Secret | Purpose |
|--------|---------|
| `CSC_LINK` / `CSC_KEY_PASSWORD` | Windows Authenticode |
| `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` | macOS notarization |

Nightly desktop builds may ship unsigned when those secrets are absent; Linux
installers always carry Sigstore blob signatures like other release artifacts.

## Snapshot and rollback rules

An update snapshot is one consistency unit containing:

- `core.sqlite` and every tenant SQLite database;
- tenant workspaces and installed plugin state;
- installation/release metadata and the plugin lock snapshot.

Snapshots use SQLite backup APIs, integrity checks, file hashes, and external
storage outside the active data directory. Preflight refuses an update when
signatures, free space, schema bounds, plugin compatibility, snapshot
verification, or installation privileges are insufficient.

Binary rollback is allowed only within the release manifest's schema
compatibility window. Otherwise recovery is roll-forward or a complete snapshot
restore, which discards writes made after that snapshot.

## Offline installations

Download the manifest, verification bundle, checksums, and required artifact on
another machine. Verify them before transfer using:

```bash
./scripts/release/verify-offline.sh <release-directory>
```

Windows administrators can use `scripts/release/verify-offline.ps1`. Offline
imports follow the same preflight, snapshot, and readiness requirements.

## Plugin compatibility

Preflight compares installed plugin engine versions, kernel client API versions,
and signed release constraints. A per-workspace plugin lock snapshot is retained
with the update evidence. Platform releases do not silently update Marketplace
plugins unless the release manifest explicitly pins a coordinated, verified
plugin artifact.
