# Contributing to GodMode

Thank you for contributing. GodMode core is released under the [Apache License 2.0](LICENSE).

## Getting started

```bash
npm install
npm run dev
```

- Web: http://localhost:5173
- Bridge: http://localhost:3847

Fresh clone = **personal OS only** (Intelligence, wiki, tasks, structure). Copy `apps/bridge/.env.example` → `.env` before `npm run dev`. Domain integrations ship as optional external plugin repos — see [docs/PLUGIN_AUTHORING.md](docs/PLUGIN_AUTHORING.md).

## Development mode

`DEPLOYMENT_MODE=local` (default) is for local development. **Authentication is required by default** (`AUTH_ALLOW_ANONYMOUS=false` in `.env.example`). Set `AUTH_ALLOW_ANONYMOUS=true` only for headless local tooling — never on a network-exposed host.

Run `npm run audit:oss` before release-related PRs.

## Pull requests

- Keep changes focused; match existing code style.
- Run `npm run typecheck` before submitting.
- Do not commit secrets (`.env`, API keys, wallet keys).
- Domain-specific integrations belong in **external plugin repos**, not the public core tree.

## Security

Report security issues via [GitHub private security advisories](https://github.com/ReBoticsAI/GodMode/security/advisories/new) — do not open public issues for production vulnerabilities. See [SECURITY.md](SECURITY.md).

## Plugins

Platform core changes belong in this repo (`@godmode/plugin-api`, `@godmode/plugin-host`, loader, install UX). Domain-specific integrations ship as plugins — see [docs/PLUGIN_AUTHORING.md](docs/PLUGIN_AUTHORING.md).
