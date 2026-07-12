# Deploying GodMode

GodMode ships in three deployment modes:

| Mode | `DEPLOYMENT_MODE` | Use case |
|------|-------------------|----------|
| **local** | `local` (default) | Personal workstation — single-user install |
| **hub** | `hub` | Multi-tenant SaaS (your VPS only) |
| **client** | `client` | Personal Docker; marketplace proxies to hub |

## Local (recommended for personal use)

No Docker required:

```powershell
npm install
copy apps\bridge\.env.example apps\bridge\.env
npm run dev
```

Open http://localhost:5173 and sign up with email and password.

## Hub (production SaaS)

1. Copy `deploy/.env.production.example` → `deploy/.env.production` and set:
   - `WEB_PUBLIC_URL`, `AUTH_PUBLIC_URL`, `WEB_ORIGIN` to your public domain
   - `AUTH_SESSION_SECRET` (32+ random bytes)
   - `AUTH_ALLOW_SIGNUP=false` or `AUTH_INVITE_CODES` for controlled onboarding
   - Stripe keys via **Admin → Billing** after first login (or `STRIPE_SECRET_KEY` env fallback)
2. Build and run:

```bash
cd deploy
docker compose -f docker-compose.prod.yml up -d --build
```

3. Point DNS at the VPS. Terminate TLS at your reverse proxy or extend `nginx.conf` with certbot.

**Security gate:** Do not expose a hub publicly until `AUTH_ALLOW_ANONYMOUS=false`, invite-only signup, and CORS locked to `WEB_ORIGIN`.

### Hub smoke test

After the container is up, verify core endpoints:

```powershell
.\scripts\hub-smoke-test.ps1 -BaseUrl http://127.0.0.1:3847
```

On VPS staging, point `-BaseUrl` at your internal Bridge URL (nginx → `127.0.0.1:3847`). Full launch validation still requires password sign-in, new-tenant bootstrap, and marketplace browse in the browser.

**Default landing:** signed-in users land on `/home` (welcome hub).

## Client (personal Docker)

1. Copy `deploy/.env.client.example` → `deploy/.env.client`.
2. Set `CLOUD_HUB_URL` to the **official** hub domain (marketplace authority).
3. Run:

```bash
cd deploy
docker compose -f docker-compose.client.yml up -d --build
```

Open http://localhost:8080. Sign in with email and password. Workspace data stays on your machine; credits and marketplace listings come from the hub.

## Data persistence

Both compose files mount `PLATFORM_DATA_DIR=/data` (SQLite tenants, core DB, tenant sandboxes).

## Intelligence on hub

New tenants get Intelligence with `backend=provider` (OpenAI-compatible). Users add API keys in **Vault → Secrets** and configure the provider in **Agents → Pipeline**.

### Hub + local GGUF on the host GPU

The production image does not run CUDA. Run `llama-server` on the host and attach from the container:

```bash
cd deploy
docker compose -f docker-compose.hub-external-llm.yml up -d --build
```

Requires `LLAMA_EXTERNAL=true`, a models bind-mount, and `host.docker.internal` → host gateway. See [docs/LOCAL_LLM.md](docs/LOCAL_LLM.md) for a recommended Gemma 4 26B / 16 GB GPU profile.

## Hardware-bound marketplace plugins

Some domain packs require a **local connector** on the user's machine. See `apps/connector/README.md`. The hub/client Docker image runs the platform core only.

## Hostinger VPS checklist

- Ubuntu 22.04+, Docker + Compose plugin
- Firewall: 80/443 only
- `deploy/.env.production` with real secrets (never commit)
- Optional: external Postgres later for `core.sqlite` at scale (not required for launch)
