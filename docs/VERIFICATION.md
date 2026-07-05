# Verification walkthrough

Use this checklist after `npm run dev` to confirm your GodMode install is working.

**Demo account:** set via seed script (`DEMO_EMAIL` / `DEMO_PASSWORD` — password required)

**Seed demo data (optional):**

```bash
DEMO_PASSWORD=your-secret node scripts/seed-readme-demo.mjs
```

---

## 1. Server health

```powershell
Invoke-RestMethod http://127.0.0.1:3847/api/health
```

Expect: `{ ok: true, deploymentMode: "local", hub: false }`

---

## 2. Official marketplace catalog

1. Sign in at http://127.0.0.1:5173
2. Open **Marketplace** (`/marketplace`)
3. **Official** tab should list three packs from [GodMode-Marketplace](https://github.com/ReBoticsAI/GodMode-Marketplace):
   - Research Agent Pack
   - Work Starter Department
   - Productivity Skills
4. Click **Install** on any pack (free)
5. Open **Installed** tab to confirm

![Marketplace Official tab](assets/readme/marketplace.png)

---

## 3. First-run onboarding

On a fresh install (or reset onboarding meta), the **FirstRunWizard** appears before the workspace:

1. Welcome step
2. Choose local GGUF, Ollama detect, or **Use cloud API (Vault)**
3. **Get started** opens the workspace

See [ONBOARDING.md](./ONBOARDING.md).

---

## 4. Shared + Tailscale network

1. Open **Shared** (`/settings/shared`)
2. **Network (Tailscale)** panel shows status and federation URL when Tailscale is running
3. **Enable Tailscale URL** sets `FEDERATION_PUBLIC_URL` for cross-home sharing
4. **Invite** sends a Tailscale email invite and records a pending peer
5. **Accept federated share invite** accepts a token from another Bridge

![Shared network panel](assets/readme/shared.png)

See [SHARED_FEDERATION.md](./SHARED_FEDERATION.md).

---

## 5. Support routing

1. Open **Support** (`/support`)
2. **New request** → choose type:
   - **GodMode platform (GitHub)** opens a prefilled [GitHub issue](https://github.com/ReBoticsAI/GodMode/issues/new)
   - **Shared resource owner** creates a ticket routed to the grant owner

![Support page](assets/readme/support.png)

---

## 6. Admin (local install)

1. Sign in as platform admin (first signup or `INITIAL_ADMINS`)
2. **Admin** should show **Workspace template**, **Users**, **Support** only
3. **Billing** tab appears only when `DEPLOYMENT_MODE=hub`

---

## 7. Verify Intelligence

1. Open **Chat** and select **Intelligence**
2. Add an LLM API key under **Vault → Secrets**, then configure the provider in **Agents → Pipeline**
3. Send a message — confirm the agent responds
4. Try chat modes from the composer:
   - **Agent** — full tool access (default)
   - **Plan** — structured planning without auto-execution
   - **Ask** — read-only Q&A
5. Optional: ask Intelligence to create a wiki page or task card to confirm platform tools work

---

## Related docs

- [MARKETPLACE.md](./MARKETPLACE.md)
- [SHARED_FEDERATION.md](./SHARED_FEDERATION.md)
- [ONBOARDING.md](./ONBOARDING.md)
- [FEATURES.md](./FEATURES.md)
- [GETTING_STARTED.md](./GETTING_STARTED.md)
