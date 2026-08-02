# Security

GodMode is a self-hosted Control Center with optional AI agents that can run tools, including terminal commands and file edits when enabled. Treat every deployment as **trusted-operator** infrastructure unless you harden it deliberately.

## Authentication

OSS / private hub uses **email/password + HttpOnly session cookies**. Production SaaS
adds email verification, password reset (Resend or SMTP), optional Google/GitHub
OAuth, and **required TOTP MFA for platform admins** (hard gate: admins cannot use
the product shell until enrolled; Admin APIs also return `MFA_REQUIRED`). Session
cookies are `Secure` when public URLs are HTTPS. Cookie-authenticated mutating
API calls require a trusted `Origin`/`Referer` matching `WEB_ORIGIN` (webhooks
remain signature-auth).

## Public SaaS launch gate

Do **not** point public DNS at SaaS until:

1. Marketing site live (`godmode.software` via Pages at `/`, or `/www` on the app origin) and Stripe business URL accepted (`BUSINESS_WEBSITE_URL`)
2. Email verify + password reset working with production mail
3. Platform admin MFA enrolled and hard-gated (Auth interstitial + `MFA_SETUP_REQUIRED` on product APIs)
4. Cloudflare → Hostinger Full (strict), origin headers, HTTPS cookies, firewall locked
5. Durable SQLite rate limits + cron backups + tested offsite restore
   (operator PC download of a nightly stamp + integrity verify; S3/R2 optional)
6. SaaS coding on by default (#178; opt out with `PLATFORM_SAAS_ALLOW_CODE_ACCESS=false`); Local plugin path registration blocked by default (`PLATFORM_SAAS_ALLOW_LOCAL_PLUGINS` unset/false)
7. Live Stripe webhooks + Customer Portal on the Cloudflare hostname
8. DEPLOY.md / this file / `deploy/hostinger.md` signed off

Observability for launch: Admin → Observability (request/error table + backup
status), first-party Bridge JSON logs + `platform_request_log`, and external
`/api/health` uptime. Do not rely on a third-party APM.

Tenant self-serve workspace download (`GET /api/tenant/database/download`) is
owner-only, rate-limited, audited (`tenant.database.download`), and streams a
consistent SQLite snapshot of the caller's tenant only. It is not a substitute
for platform backup DR.

See [DEPLOY.md](../DEPLOY.md) and [deploy/hostinger.md](../deploy/hostinger.md).

## Open-source threat model (public repo)

A public repository is a **public attack map**. Assume attackers read every route,
default, and compose file.

- Never commit secrets (`.env`, Stripe keys, session secrets, OAuth client secrets).
- Public SaaS must sit behind Cloudflare (or equivalent) with paywall + MFA.
- Edge WAF is mandatory for internet-facing hubs; LAN staging is not a substitute.
  **Bot Fight Mode** on Cloudflare Free is optional for v1 (pay-first signup already
  gates tenants); enable and test Stripe webhooks if you turn it on.

## Production checklist

Before exposing Bridge to a network:

1. Set `DEPLOYMENT_MODE=hub` or `client` (never leave `local` on a public host).
2. Set `AUTH_ALLOW_ANONYMOUS=false`.
3. Set a strong `AUTH_SESSION_SECRET` (even though sessions are opaque DB IDs today, operators expect this to be set).
4. Set `INITIAL_ADMINS` for multi-admin hubs, or rely on first-signup admin only on isolated self-hosted instances.
5. Set `AUTH_ALLOW_SIGNUP=false` or require `AUTH_INVITE_CODES` on public hubs (SaaS uses Checkout entitlement instead).
6. Do not set `INITIAL_ADMIN_PASSWORD` in production unless you force password change on first login.
7. Install plugins only from sources you trust — plugin bridge code runs with host privileges.
8. On SaaS, coding is on by default (#178); set `PLATFORM_SAAS_ALLOW_CODE_ACCESS=false` to opt out. Keep `PLATFORM_SAAS_ALLOW_LOCAL_PLUGINS` unset/false. Enable Layer 4 via the host build supervisor (`CODING_BUILD_MODE=ephemeral`, allowlist net for registry). Residual shared-host isolation is #172.
9. Public marketing site live before live Stripe.

## Threat model highlights

| Surface | Risk | Mitigation |
|---------|------|------------|
| AI coding tools (`run_terminal`, `edit_file`) | RCE for editors/agents with `codeAccess` | SaaS coding on by default (#178); opt out with `PLATFORM_SAAS_ALLOW_CODE_ACCESS=false`. Per-tenant/global concurrency caps and runtime kill switches (#96 Slice 1). Disable per agent; confirm mode. Layers 1–4 apply when enabled |
| Credits / LLM spend | Unbounded credit burn or runaway autonomous work | Runtime global/per-tenant spend kill + optional `PLATFORM_SPEND_DISABLED` (#96 Slice 3). Blocks credit debits, chat, autonomous ticks, and AI queue jobs. Full budgets remain #91 |
| Plugin deploy | Unbounded plugin build/install/promote on shared host | Runtime global/per-tenant deploy kill + optional `PLATFORM_DEPLOY_DISABLED` (#96 Slice 4). Blocks esbuild, activate/install paths, and worktree promote. Distinct from Layer 4 ephemeral build kill |
| Destructive deletes | Runaway record/file/wiki/plugin wipe | Runtime global/per-tenant delete kill + optional `PLATFORM_DELETE_DISABLED` (#96 Slice 5). Blocks kernel deletes, coding FS deletes, wiki pages, and plugin uninstall. Tenant wipe and reconcile uninstall stay exempt |
| Automation outbound send | Hook webhook exfil / spam DMs | Runtime global/per-tenant send kill + optional `PLATFORM_SEND_DISABLED` (#96 Slice 6). Blocks hook `webhook` and `send_message` only. Auth mail, human DMs, agent replies, and in-app notify stay exempt |
| Authority audit visibility | Missed or siloed kill/quota rejects across domains | Unified reject feed in Admin → Authority (#96 Slice 7). Merges `tool_audit_log` rows from coding, spend, deploy, delete, send, and agent gates with optional domain filter |
| Runaway agent execution | Single agent or workspace keeps burning LLM turns | Runtime global/per-tenant/per-agent pause + optional `PLATFORM_AGENTS_DISABLED` (#96 Slice 8). Blocks chat, autonomous, queue agent jobs, subagents, and replies without mutating `ai_agents.enabled` |
| Hub/SaaS coding root | Cross-tenant file access via tools or Coding UI | Layer 1: coding root is always `tenant-workspaces/<tenantId>/`; agent workspace and plugin paths must stay under that root (issue #112) |
| Hub/SaaS agent worktrees | Accidental edits to live tenant plugins during iterative work | Layer 2: Bridge-owned git worktrees under `{tenant}/.worktrees/<slug>`; coding tools and `scaffold_plugin` honor `agent.config.workspace`; `coding_worktree_promote` merges into the live tenant tree then builds/installs from live `plugins/<id>` (never leave install rooted under `.worktrees/`) |
| Hub/SaaS `run_terminal` / shared PTY | Shell escape past tenant root; host/Docker abuse; human+agent stdin races | Layer 3: bubblewrap FS jail on hub/client Linux (`CODING_TERMINAL_SANDBOX=required`). **Fail closed:** if `bwrap` is missing or the probe fails, `run_terminal`, shared PTY sessions, and coding helpers (`rg`, `tsc`, `git` worktree) refuse (no unsandboxed fallback). SaaS/hub default `CODING_TERMINAL_NET=none` (`--unshare-net`). Prefer `allowlist` over `shared` for npm/git: `--unshare-net` plus a Bridge CONNECT proxy on a Unix socket under the tenant root (in-jail TCP→UDS bridge for `HTTP_PROXY`). Raw TCP cannot leave the jail; only allowlisted CONNECT hosts (ports 80/443) egress via Bridge. Helpers always use `net=none`. `shared` is full host network with FS jail only. Docker hosts typically need `cap_add: [SYS_ADMIN, NET_ADMIN]` plus `security_opt: [seccomp:unconfined, apparmor:unconfined]` so namespaces work. Human Coding **Terminal** tab: one-shot `run_terminal` runner plus **shared PTY sessions** (#162) via `node-pty` + xterm attach over `/ws/terminal`. Attach model: agent and human share stdin (not simultaneous co-ownership); when a human is attached they take over typing; audit create/write/close. Monitor batches/caps lines into chat (never unbounded scrollback). Gated by coding UI / SaaS code access |
| Hub/SaaS `cursor_cloud` built-in Shell | SDK local agent can use Cursor built-in Shell/edit outside GodMode customTools | `#171`: `CURSOR_SDK_SANDBOX=required` on hub/client Linux enables SDK `sandboxOptions` (bubblewrap/seatbelt). FS limited to tenant `cwd`; network deny-by-default with tenant `{cwd}/.cursor/sandbox.json` allowlist (skip-if-exists; never `~/.cursor/sandbox.json`). GodMode customTools remain Bridge Layers 1–4. Not Cursor Cloud VM isolation |
| Hub/SaaS ephemeral builds | Host Docker abuse; cross-tenant bind mounts; registry egress | Layer 4 (#164 / #167 / #170): host **build supervisor** owns `docker.sock` (never Bridge or tenant jail). Bridge calls localhost bearer HTTP (`CODING_BUILD_SUPERVISOR_URL` / `TOKEN`) like the update supervisor. Ephemeral `docker run --rm` binds only `tenant-workspaces/<tenantId>`; command allowlist (`npm ci` / install / run build / test / typecheck); network `none` by default. Opt-in `CODING_BUILD_NET=allowlist` attaches builds to a Docker **`--internal`** network (no public internet route) plus a supervisor CONNECT proxy (ports 80/443) via `host.docker.internal` for npm/git hosts (`CODING_BUILD_EGRESS_HOSTS` or terminal egress defaults). Tools that ignore `HTTP_PROXY` cannot reach the internet. Opt-in via `CODING_BUILD_MODE=ephemeral` (fail closed if URL/token missing). Default `build_plugin` stays in-process esbuild |

### SaaS coding isolation posture (#112)

Layers 1–3 (plus shared PTY #162) and `cursor_cloud` SDK sandbox (#171) are a **production-minded** boundary for shared hub/SaaS coding: tenant path isolation, OS filesystem jail for terminal/helpers, kernel-enforced egress allowlist, and SDK jail for Cursor built-in Shell. They are **not** bank-grade or Cursor Cloud VM isolation.

**Two sandboxes for Intelligence `cursor_cloud`:** Bridge Layers 1–4 jail GodMode `customTools`. SDK `sandboxOptions` (when `CURSOR_SDK_SANDBOX=required`) jails Cursor built-in Shell/FS under the tenant coding root. GodMode tools do not rely on the SDK sandbox.

**Layer 4** (SaaS staging/prod recommended via #178): ephemeral npm builds via a host build supervisor (`deploy/build-supervisor/`). Prefer a **separate supervisor or token per data root** so SaaS builds never bind private_hub tenant paths. Default build network is `none`; staging/prod demos use `allowlist` (Docker `--internal` network + host CONNECT proxy). Residual risks: the supervisor is a privileged Docker client on the host; compose publishes supervisor/egress ports on all host interfaces so Linux Bridge containers can reach them via `host.docker.internal` (loopback-only publish breaks host-gateway); operators must firewall WAN NICs and rotate `CODING_BUILD_SUPERVISOR_TOKEN`; a same-named non-internal Docker network fails closed until removed. Non-HTTP egress (SSH / `git@` / arbitrary TCP) is deferred for SaaS defaults (#173): use HTTPS remotes for private git; trusted single-tenant hosts may set `CODING_TERMINAL_NET=shared` if they truly need SSH. Full `shared` build networks remain out of scope. Shared-host VM-grade isolation is #172.

| Local plugin path registration | Tenant RCE via arbitrary folders | Blocked on SaaS unless `PLATFORM_SAAS_ALLOW_LOCAL_PLUGINS` |
| Marketplace Official/Community plugin install | Floating `main` pulls or digest drift after intake verify | **Buyer pin (#177):** install requires immutable `pluginRef` (tag or commit); optional `pluginDigest` must match `HEAD`. No `git pull` to latest. Local folder installs remain operator-trusted. **Network grants (#290):** deny-by-default unless catalog/manifest hosts granted |
| Installed plugin code in Bridge process | Malicious plugin APIs against tenant data after install | Distinct from coding jail (#112) and from Marketplace intake CI. Network egress via `host.externalFetch` is deny-by-default for Official/Community (#290). Kill switches (#96). True plugin process/container sandbox is optional later |
| Federation API token | Remote command injection if token leaks | Rotate tokens; restrict network access |
| First signup admin | Race on internet-exposed fresh installs | Use invite codes, paywall, or pre-seed `INITIAL_ADMINS` |
| Plugin bundles (`/api/plugins/*/web.js`) | Proprietary JS exposure | Requires authenticated tenant + installed plugin |
| Generic Records/actions (`/api/records/*`) | Cross-tenant or overbroad mutation | OperationContext, access/action policy, adapter scoping |
| Release manifests and update artifacts | Supply-chain execution or downgrade | Signed manifests, immutable digests, compatibility bounds, administrator confirmation |
| Host update supervisor | Privileged container/service replacement | Dedicated authenticated local-host IPC; never expose the Docker socket to Bridge |
| DuckDB platform analytics | SQL against tenant analytics DB | Platform admin only; SELECT-only subset; market ticks live in domain plugins |
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

## Marketplace buyer protection (threat boundaries)

Intake verification (Marketplace CI smoke / optional review) raises the floor but
does **not** guarantee benign runtime behavior after install. Keep these
boundaries distinct:

| Boundary | What it covers | What it does not |
|----------|----------------|------------------|
| **Intake** (Marketplace verify VM / Actions) | Public repo pin, one-shot smoke before listing | Time bombs, env-gated exfil, abuse of allowed APIs on the buyer hub |
| **Buyer install pin (#177)** | Official/Community installs must use immutable `pluginRef` (tag or commit); optional `pluginDigest` fail-closed on drift; no floating `main` / `git pull` | Capability allowlists alone |
| **Plugin capability grants (#290)** | Network deny-by-default for Official/Community; `host.externalFetch` allowlist from catalog `networkHosts` + manifest `capabilities.network.hosts`; Local/operator unrestricted; revoke via uninstall (and kill switches #96) | Blocking raw in-process `fetch`; tool/record allowlists (follow-up); true plugin process sandbox |
| **Coding jail (#112 Layers 1–4)** | Per-tenant coding root + bubblewrap terminal/helpers on a **shared** Bridge host | Isolating *installed plugin* code (plugins load in the Bridge Node process today) |
| **VM-grade coding jobs (#172)** | Disposable machines for untrusted build/coding jobs | Per-plugin runtime sandbox on the buyer hub |
| **Kill switches (#96)** | Deploy/spend/send/agent emergency stops | Fine-grained plugin capability grants (use #290 + uninstall) |

Extending CI smoke or Copilot review on intake is encouraged and still not
sufficient alone. A true plugin-per-process/container sandbox remains optional
and expensive.

### Trust tiers (#290)

| Tier | Typical source | Network default |
|------|----------------|-----------------|
| **Official** | Curated Official catalog (remote clone) | Deny unless `networkHosts` / manifest hosts granted at install |
| **Community** | Community listings (remote clone) | Same as Official |
| **Local** | `pluginLocalPath` / Local catalog folders | Unrestricted (operator-trusted path) |
| **Operator** | `GODMODE_PLUGIN_PATH` and other non-marketplace roots | Unrestricted |

Plugins should call `api.host.externalFetch(url)` for outbound http(s). Loopback
`bridgeFetch` stays allowed. Uninstall removes the install root grants file;
deploy/delete kill switches (#96) remain the emergency stop for install/wipe.

## Reporting

Open a private security advisory on GitHub for vulnerabilities in the public core. Do not commit secrets, wallet keys, or operator `.env` files.
