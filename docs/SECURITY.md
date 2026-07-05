# Security

GodMode is a self-hosted personal OS with optional AI agents that can run tools, including terminal commands and file edits when enabled. Treat every deployment as **trusted-operator** infrastructure unless you harden it deliberately.

## Production checklist

Before exposing Bridge to a network:

1. Set `DEPLOYMENT_MODE=hub` or `client` (never leave `local` on a public host).
2. Set `AUTH_ALLOW_ANONYMOUS=false`.
3. Set a strong `AUTH_SESSION_SECRET` (even though sessions are opaque DB IDs today, operators expect this to be set).
4. Set `INITIAL_ADMINS` for multi-admin hubs, or rely on first-signup admin only on isolated self-hosted instances.
5. Set `AUTH_ALLOW_SIGNUP=false` or require `AUTH_INVITE_CODES` on public hubs.
6. Do not set `INITIAL_ADMIN_PASSWORD` in production unless you force password change on first login.
7. Install plugins only from sources you trust — plugin bridge code runs with host privileges.

## Authentication

OSS core uses **email/password + HttpOnly session cookies** only. There is no OAuth login surface — credentials never leave your Bridge unless you expose it to a network.

## Threat model highlights

| Surface | Risk | Mitigation |
|---------|------|------------|
| AI coding tools (`run_terminal`, `edit_file`) | RCE for editors/agents with `codeAccess` | Disable code access on agents; use confirm mode |
| Federation API token | Remote command injection if token leaks | Rotate tokens; restrict network access |
| First signup admin | Race on internet-exposed fresh installs | Use invite codes or pre-seed `INITIAL_ADMINS` |
| Plugin bundles (`/api/plugins/*/web.js`) | Proprietary JS exposure | Requires authenticated tenant + installed plugin |
| DuckDB analytics | SQL against attached timeseries | Platform admin only; SELECT-only subset |
| Markdown rendering | `javascript:` links in assistant/wiki output | URL scheme allowlist in web UI |

## Reporting

Open a private security advisory on GitHub for vulnerabilities in the public core. Do not commit secrets, wallet keys, or operator `.env` files.
