# Security

GodMode is a self-hosted personal OS with optional AI agents that can run tools, including terminal commands and file edits when enabled. Treat every deployment as **trusted-operator** infrastructure unless you harden it deliberately.

## Authentication

OSS / private hub uses **email/password + HttpOnly session cookies**. Production SaaS
adds email verification, password reset (Resend or SMTP), optional Google/GitHub
OAuth, and **required TOTP MFA for platform admins**. Session cookies are `Secure`
when public URLs are HTTPS. Cookie-authenticated mutating API calls require a
trusted `Origin`/`Referer` matching `WEB_ORIGIN` (webhooks remain signature-auth).

## Public SaaS launch gate

Do **not** point public DNS at SaaS until:

1. Marketing site live (`/www` on the web app, shadcn) and Stripe business URL accepted (`BUSINESS_WEBSITE_URL`)
2. Email verify + password reset working with production mail
3. Platform admin MFA enrolled and enforced
4. Cloudflare → Hostinger Full (strict), origin headers, HTTPS cookies, firewall locked
5. Durable SQLite rate limits + cron backups + tested offsite restore
6. SaaS defaults: deny agent `codeAccess`; block arbitrary Local plugin paths
7. Live Stripe webhooks + Customer Portal on the Cloudflare hostname
8. DEPLOY.md / this file / `deploy/hostinger.md` signed off

Observability for launch: Admin → Observability (request/error table + backup
status), first-party Bridge JSON logs + `platform_request_log`, and external
`/api/health` uptime. Do not rely on a third-party APM.

See [DEPLOY.md](../DEPLOY.md) and [deploy/hostinger.md](../deploy/hostinger.md).

## Open-source threat model (public repo)

A public repository is a **public attack map**. Assume attackers read every route,
default, and compose file.

- Never commit secrets (`.env`, Stripe keys, session secrets, OAuth client secrets).
- Public SaaS must sit behind Cloudflare (or equivalent) with invite/paywall + MFA.
- Edge WAF is mandatory for internet-facing hubs; LAN staging is not a substitute.

## Production checklist

Before exposing Bridge to a network:

1. Set `DEPLOYMENT_MODE=hub` or `client` (never leave `local` on a public host).
2. Set `AUTH_ALLOW_ANONYMOUS=false`.
3. Set a strong `AUTH_SESSION_SECRET` (even though sessions are opaque DB IDs today, operators expect this to be set).
4. Set `INITIAL_ADMINS` for multi-admin hubs, or rely on first-signup admin only on isolated self-hosted instances.
5. Set `AUTH_ALLOW_SIGNUP=false` or require `AUTH_INVITE_CODES` on public hubs (SaaS uses Checkout entitlement instead).
6. Do not set `INITIAL_ADMIN_PASSWORD` in production unless you force password change on first login.
7. Install plugins only from sources you trust — plugin bridge code runs with host privileges.
8. On SaaS, leave `PLATFORM_SAAS_ALLOW_CODE_ACCESS` and `PLATFORM_SAAS_ALLOW_LOCAL_PLUGINS` unset/false unless you explicitly accept the risk.
9. Public marketing site live before live Stripe.

## Threat model highlights

| Surface | Risk | Mitigation |
|---------|------|------------|
| AI coding tools (`run_terminal`, `edit_file`) | RCE for editors/agents with `codeAccess` | SaaS defaults deny `codeAccess`; disable on agents; confirm mode |
| Local plugin path registration | Tenant RCE via arbitrary folders | Blocked on SaaS unless `PLATFORM_SAAS_ALLOW_LOCAL_PLUGINS` |
| Federation API token | Remote command injection if token leaks | Rotate tokens; restrict network access |
| First signup admin | Race on internet-exposed fresh installs | Use invite codes, paywall, or pre-seed `INITIAL_ADMINS` |
| Plugin bundles (`/api/plugins/*/web.js`) | Proprietary JS exposure | Requires authenticated tenant + installed plugin |
| Generic Records/actions (`/api/records/*`) | Cross-tenant or overbroad mutation | OperationContext, access/action policy, adapter scoping |
| Release manifests and update artifacts | Supply-chain execution or downgrade | Signed manifests, immutable digests, compatibility bounds, administrator confirmation |
| Host update supervisor | Privileged container/service replacement | Dedicated authenticated local-host IPC; never expose the Docker socket to Bridge |
| DuckDB analytics | SQL against attached timeseries | Platform admin only; SELECT-only subset |
| Markdown rendering | `javascript:` links in assistant/wiki output | URL scheme allowlist in web UI |
| Auth token endpoints | Account takeover / enumeration | Durable rate limits; opaque responses; hashed one-time tokens |

## ObjectType kernel boundary

Generic Record routes do not replace authentication or domain authorization.
Each call receives an `OperationContext` containing tenant, user, role, source,
installed plugin IDs, confirmation state, request/idempotency key, and expected
version where applicable.

The dispatcher applies tenant visibility and ObjectType access policy, declared
operation/action roles, confirmation, JSON Schema validation, idempotency, and
optimistic concurrency before invoking an adapter. Adapters and authoritative
services remain responsible for resource-level checks and domain invariants.
Secret fields and declared sensitive action paths are redacted from audit data.
Asynchronous actions retain auditable `OperationRun` state and generically
enforce declared retries/backoff, timeout, cancellation eligibility, error
schema, idempotency expiry, and replay-safe recovery. Leases and heartbeats
prevent concurrent workers from owning the same run; interrupted work is
requeued only with a retry/idempotency guarantee and otherwise fails closed.

Ordinary callers cannot forge `source: "system"`; trusted system dispatch
requires an internal capability. Declared durable events use relay leases and
per-consumer success receipts, providing at-least-once delivery without
pretending to provide exactly-once side effects.

Shared-resource authorization resolves the exact active grant, resource kind,
resource ID, role, expiry, and owner tenant database. Viewer grants cannot
mutate; editor mutations target the owner's record; missing, revoked, expired,
wrong-kind, clone, and guessed-ID access fails closed.

Plugin ObjectTypes are visible only when their owner is installed for the active
tenant. This protection does not automatically wrap a plugin's custom Express
routes; plugin authors must authenticate, resolve the tenant, and check
installation explicitly. Plugin Bridge code still runs with host privileges.

Native ObjectType uninstall retains physical tables and Records to avoid
destructive data loss. Operators must include core and tenant SQLite files in
backups and handle erasure requirements explicitly.

## Release and updater trust

Only GitHub Actions runs that complete the full validation gate may publish a
nightly or stable release manifest. A manifest is data, never a command script:
the updater accepts only known fields and verifies its signature, channel,
version, commit, artifact digest/hash, engine/kernel compatibility, schema
bounds, and rollback class before staging anything.

Bridge does not receive the Docker socket or operating-system service-manager
privileges. Docker and bare-metal replacement is performed by the separately
installed host updater over a dedicated authenticated local-host endpoint, or by an administrator
running the printed verified command. Update application requires a complete,
integrity-checked snapshot outside the active data directory and a successful
post-start readiness check. Invalid signatures, revoked metadata, unavailable
rollback paths, incompatible plugins, and failed snapshot verification must
fail closed.

Keyless signatures are accepted only for the pinned GitHub Actions issuer and
GodMode release-workflow identity. Sigstore's TUF-distributed trust root and
transparency evidence support certificate/root rotation without trusting a key
shipped beside the artifact. Offline imports require the complete verification
bundle captured at publication time. A compromised workflow identity or
repository requires disabling update polling, revoking affected releases, and
publishing fresh artifacts after the GitHub/Sigstore incident is resolved; never
replace the pinned identity with an arbitrary repository wildcard.

Multipart upload/download, WebSocket/token streams, cookie establishment,
ephemeral presence, read-only analytical POST, signed external command
transport, and Marketplace/SaaS payment webhooks remain explicit protocol
exceptions. They must retain their own transport authorization, and any durable
domain effect still dispatches through the kernel; binary and stream transport
are not Record CRUD.

Paid Marketplace plugins are still host-privileged code once installed — review
sources before install. Chargebacks on delivered software ban Marketplace access
per [MARKETPLACE_TOS.md](MARKETPLACE_TOS.md).

## Reporting

Open a private security advisory on GitHub for vulnerabilities in the public core. Do not commit secrets, wallet keys, or operator `.env` files.
