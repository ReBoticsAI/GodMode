# Getting started

GodMode is a local-first personal OS. Pick the path that matches how you want to run it.

## Download (recommended for most users)

Install the desktop app from [GitHub Releases](https://github.com/ReBoticsAI/GodMode/releases):

- **Windows** — `GodMode-Setup-*-windows-x64.exe`
- **macOS** — `GodMode-*-darwin-arm64.dmg` or `darwin-x64.dmg`
- **Linux** — `GodMode-*-linux-x64.AppImage` (or `.deb`)

Open the app, create an account, and use **Admin → Updates** when a new release is available. No Docker or Node install required. See [RELEASES.md](./RELEASES.md).

## Developer clone

### Requirements

- Node.js 22.13+
- npm 10+
- Windows, macOS, or Linux

### Install

```powershell
git clone https://github.com/ReBoticsAI/GodMode.git
cd GodMode
npm install
copy apps\bridge\.env.example apps\bridge\.env   # Windows
# cp apps/bridge/.env.example apps/bridge/.env    # macOS/Linux
npm run dev
```

This clone-and-`npm run dev` path is the developer installation channel. It
does not self-update. Supported desktop, Docker, and bare-metal release
installations use signed artifacts and surface stable/nightly release checks
under **Admin → Updates** for platform administrators.

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

1. **Welcome** — overview of Intelligence and why an LLM is required
2. **Choose your LLM** — local GGUF, detect Ollama, or use a cloud / Cursor path via Vault
3. **Ready** — open Chat and start with Intelligence

Complete the wizard, then open **Chat** from the sidebar. Details: [ONBOARDING.md](./ONBOARDING.md).

## First Intelligence chat

1. Open **Chat** and select **Intelligence**
2. Ensure an LLM is ready:
   - **Local:** GGUF under your model dirs (see [LOCAL_LLM.md](./LOCAL_LLM.md)), or
   - **Cursor:** Vault → **Cursor subscription** → Connect, then pick Auto / a named model ([CURSOR_SUBSCRIPTION.md](./CURSOR_SUBSCRIPTION.md)), or
   - **Cloud provider:** Vault → Secrets + Intelligence model picker / Agents → Pipeline
3. Ask Intelligence to create a department, wiki page, or task — it uses platform tools to mutate your workspace

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
| Local Gemma / hub attach | [LOCAL_LLM.md](./LOCAL_LLM.md) |
| Cursor subscription chat | [CURSOR_SUBSCRIPTION.md](./CURSOR_SUBSCRIPTION.md) |
| Agent memory / embeddings | [AGENT_MEMORY.md](./AGENT_MEMORY.md) |
| Full env reference | [CONFIGURATION.md](./CONFIGURATION.md) |
| Post-install checklist | [VERIFICATION.md](./VERIFICATION.md) |
| Releases, updates, and rollback | [RELEASES.md](./RELEASES.md) |

## Demo seed (screenshots)

For README captures or a populated demo tenant:

```powershell
$env:DEMO_PASSWORD = "your-demo-password"
node scripts/seed-readme-demo.mjs
```

`DEMO_PASSWORD` is required — there is no default.

See also [ONBOARDING.md](./ONBOARDING.md) and [FEATURES.md](./FEATURES.md).
