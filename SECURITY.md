# Security Policy

GodMode is a self-hosted personal OS. Treat every deployment as **trusted-operator** infrastructure unless you harden it deliberately.

## Supported versions

| Version | Supported |
|---------|-----------|
| `main` (latest release) | Yes |
| Older tags | Best effort |

## Reporting a vulnerability

**Do not** open public GitHub issues for security vulnerabilities.

Use [GitHub private security advisories](https://github.com/ReBoticsAI/GodMode/security/advisories/new) for the public core repository.

Include: affected version, deployment mode (`local` / `hub` / `client`), reproduction steps, and impact assessment.

## Production checklist

Full threat model and hardening steps: **[docs/SECURITY.md](docs/SECURITY.md)**

Minimum before exposing Bridge to a network:

1. `DEPLOYMENT_MODE=hub` or `client` — never `local` on a public host
2. `AUTH_ALLOW_ANONYMOUS=false`
3. Strong `AUTH_SESSION_SECRET`
4. `AUTH_ALLOW_SIGNUP=false` or `AUTH_INVITE_CODES` on public hubs
5. CORS locked to your `WEB_ORIGIN`
6. Install plugins only from sources you trust

## Related

Full threat model and hardening: **[docs/SECURITY.md](docs/SECURITY.md)**
