# Getting started

GodMode is a local-first personal OS. This guide walks from clone to your first Intelligence chat.

## Requirements

- Node.js 20+
- npm 10+
- Windows, macOS, or Linux

## Install

```powershell
git clone https://github.com/ReBoticsAI/GodMode.git
cd GodMode
npm install
copy apps\bridge\.env.example apps\bridge\.env   # Windows
# cp apps/bridge/.env.example apps/bridge/.env    # macOS/Linux
npm run dev
```

| Service | URL |
|---------|-----|
| Web dashboard | http://localhost:5173 |
| Bridge API | http://localhost:3847 |

## Sign up

1. Open http://localhost:5173
2. Click **Sign up** and create an account with email and password
3. When `INITIAL_ADMINS` is empty (OSS default), the **first signup becomes platform admin**

![Sign up](assets/readme/auth-signup.png)

## First-run wizard

After signup, the **FirstRunWizard** guides three steps:

1. **Welcome** — overview of Intelligence and structure
2. **Profile** — display name and persona basics for Digital You
3. **Ready** — open Chat and start with Intelligence

Complete the wizard, then open **Chat** from the sidebar.

## First Intelligence chat

1. Open **Chat** and select **Intelligence**
2. Add an LLM provider key under **Vault → Secrets** (or use a local model if configured)
3. Configure the model in **Agents → Pipeline** for Intelligence
4. Ask Intelligence to create a department, wiki page, or task — it uses platform tools to mutate your workspace

Try chat modes from the composer:

- **Agent** — full tool access (default)
- **Plan** — structured planning without auto-execution
- **Ask** — read-only Q&A

Slash commands (type `/` in the composer) include `/help`, `/clear`, and workspace shortcuts — see **Settings → Commands**.

## Optional next steps

| Goal | Where |
|------|--------|
| Edit navigation tree | **Structure** (`/structure`) |
| Install a plugin pack | **Marketplace → Unofficial** (local folder or catalog) |
| Private plugin | [MARKETPLACE.md](./MARKETPLACE.md#private-plugins) |
| Full env reference | [CONFIGURATION.md](./CONFIGURATION.md) |
| Post-install checklist | [VERIFICATION.md](./VERIFICATION.md) |

## Demo seed (screenshots)

For README captures or a populated demo tenant:

```powershell
$env:DEMO_PASSWORD = "your-demo-password"
node scripts/seed-readme-demo.mjs
```

`DEMO_PASSWORD` is required — there is no default.

See also [ONBOARDING.md](./ONBOARDING.md) and [FEATURES.md](./FEATURES.md).
