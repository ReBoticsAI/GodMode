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

On a fresh **workspace** (or reset tenant onboarding settings), the **FirstRunWizard** appears before the workspace:

1. Welcome step
2. Choose local GGUF, Ollama detect, or **Use cloud API (Vault)**
3. **Get started** opens the workspace

Each user/workspace completes this independently on multi-tenant hubs.

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
3. On hubs: Admin can staff a **Support group** (users and/or agents) who answer inbound tickets

![Support page](assets/readme/support.png)

---

## 6. Admin (local install)

1. Sign in as platform admin (first signup or `INITIAL_ADMINS`)
2. **Admin** should show **Workspace template**, **Users**, **Support** only
3. **Billing** tab appears only when `DEPLOYMENT_MODE=hub`

---

## 7. Verify Intelligence

1. Open **Chat** and select **Intelligence**
2. Pick a model from the composer catalog (local GGUF, Cursor, or provider) — or connect Cursor under **Vault → Cursor subscription**
3. Confirm **EmbeddingGemma** (and other embed-only GGUFs) do **not** appear as chat models
4. Send a message — confirm the agent responds
5. Try chat modes from the composer:
   - **Agent** — full tool access (default)
   - **Plan** — structured planning without auto-execution
   - **Ask** — read-only Q&A
6. Optional: ask Intelligence to create a wiki page or task card to confirm platform tools work

### Optional: Cursor subscription

1. **Vault → Cursor subscription** → paste User API key → **Connect**
2. Badge shows **Connected**; Intelligence picker lists **Auto (Cursor picks)** and named models
3. Chat with tools (e.g. remember / list skills) under `cursor_cloud`

See [CURSOR_SUBSCRIPTION.md](./CURSOR_SUBSCRIPTION.md).

### Optional: embeddings / memory

When `EMBEDDINGS_ENABLED=true` (and optionally `EMBEDDINGS_EXTERNAL`):

1. Embedder health responds on the configured host/port (default `:8082`)
2. Saving a memory indexes for hybrid RAG; chat can inject a memory section

See [AGENT_MEMORY.md](./AGENT_MEMORY.md) and [CONFIGURATION.md](./CONFIGURATION.md).

### Optional: Devtools plugins (git / GitHub)

1. **Marketplace → Official** → install **Git** and **GitHub**
2. Confirm `git` and `gh` work on the Bridge host
3. Ask Intelligence to show `git_status` for the coding root
4. For a full loop (do not force-push): small doc edit → commit → push → `gh_pr_create` on a throwaway branch

See [MARKETPLACE.md](./MARKETPLACE.md#official-devtools-plugins-git--github).

---

## 8. ObjectType kernel regression checks

Run the automated gate before deployment:

```bash
npm run audit:kernel:strict
npm run typecheck
npm test
npm run build --workspace @godmode/bridge
npm run build --workspace @godmode/web
```

`npm run test:gate` runs the package build, typecheck, kernel audit, and test
suite together. At the completion baseline, strict audit output must report:

- 15 mutation routes: 3 kernel Record, 2 kernel action, 5 kernel-delegated,
  5 protocol exceptions;
- 0 legacy routes, 0 legacy callers, 0 unmatched mutation callers;
- 0 direct SQL/filesystem writes in audited entry points;
- 72 ObjectTypes, 75 static tools, 335 generated tool candidates, and
  0 static/generated collisions.

Then validate the production deployment manually:

1. Build the production Docker image and confirm `/api/health` returns `ok`.
2. Sign in and inspect `/api/object-types` and `/api/kernel/capabilities`; the
   deployed registry should expose the 72 audited core ObjectTypes including
   `StructureNode`, plus the ObjectTypes from plugins installed for that tenant.
3. Create, update, read, list, and delete a disposable Record through a supported
   ObjectType. Confirm unsupported operations are rejected.
4. Execute a lifecycle action and verify invalid input, missing role, and missing
   confirmation are rejected.
5. Start asynchronous actions and inspect their `OperationRun` rows. Verify
   timeout, retry/backoff, max-attempt exhaustion, declared cancellation,
   idempotent replay, and restart/expired-lease recovery. Confirm replay-unsafe
   interrupted work fails with `KERNEL_REPLAY_UNSAFE`.
6. Install a plugin with ObjectTypes, confirm its navigation and Records appear
   only for that tenant, uninstall it, and confirm the runtime visibility is
   removed while native data remains available for reinstall/recovery.
7. Exercise Structure navigation, generic Record list/form pages, and a declared
   action from the web UI.
8. Confirm live chat still streams tokens; streaming is a protocol exception,
   not a normal Record action response.
9. Upload and download a DM attachment and confirm authorized binary transfer
   still works. Do not describe multipart or byte-stream transport as Record
   CRUD.
10. Trigger a declared durable event, fail one named consumer, then retry.
    Confirm completed consumer receipts are skipped and the unfinished consumer
    resumes.
11. With two tenants, verify a shared-resource viewer can read but cannot
    mutate, an editor writes the owner's database, and revoked, expired,
    wrong-kind, clone, and guessed-ID access fails closed.
12. Interrupt a marketplace clone acquisition between core and tenant steps,
    repeat it with the same idempotency key, and confirm the saga resumes to one
    import and one purchase.

### Z440 revision and image identity

Run this from the Z440 checkout before the manual browser pass. Do not infer the
deployed revision from a branch name or container creation time.

```powershell
$ExpectedRevision = "<reviewed-full-sha>"
if ((git rev-parse HEAD).Trim() -ne $ExpectedRevision) {
  throw "Z440 checkout is not the reviewed revision"
}
if (git status --porcelain) {
  throw "Z440 checkout has uncommitted files"
}

docker compose -f deploy/docker-compose.prod.yml build --no-cache godmode
$BuiltImage = (docker compose -f deploy/docker-compose.prod.yml images -q godmode).Trim()
if (-not $BuiltImage) { throw "No built GodMode image ID" }

docker compose -f deploy/docker-compose.prod.yml up -d --force-recreate godmode
$Container = (docker compose -f deploy/docker-compose.prod.yml ps -q godmode).Trim()
$RunningImage = (docker inspect --format '{{.Image}}' $Container).Trim()
if ($RunningImage -ne $BuiltImage) {
  throw "Running container image does not match the reviewed revision"
}

git rev-parse HEAD
docker image inspect $BuiltImage --format 'image={{.Id}} created={{.Created}}'
docker inspect --format 'container={{.Id}} image={{.Image}} started={{.State.StartedAt}}' $Container
Invoke-RestMethod http://127.0.0.1/api/health
```

Record the full 40-character revision, immutable image ID, and running
container image ID with the test evidence.

### Browser regression checklist

The Z440 browser pass is manual; Playwright is not part of CI. Mark each item
only after a human or browser agent verifies the running image:

- sign up/sign in, tenant switch, and first-run wizard;
- Home, Structure, Wiki, Tasks, Calendar, Notifications, Vault, Bank, Support,
  Shared, Marketplace, Agents/Pipeline, and Settings load without console or
  network errors;
- Intelligence chat streams tokens and executes a generated Record/action tool;
- generic Record list/form create, edit, action, and delete flows;
- viewer/editor shared-resource behavior across two tenants;
- plugin install, navigation, Record/action use, uninstall, and reinstall;
- DM text, typing presence, attachment upload, and binary download;
- page refresh and Bridge restart preserve completed durable state and recover
  eligible async work.

This checklist is pending until the parent task records browser confirmation; an
updated document or passing automated tests alone do not establish completion.

See [OBJECTTYPE_KERNEL.md](./OBJECTTYPE_KERNEL.md).

---

## Related docs

- [MARKETPLACE.md](./MARKETPLACE.md)
- [SHARED_FEDERATION.md](./SHARED_FEDERATION.md)
- [ONBOARDING.md](./ONBOARDING.md)
- [FEATURES.md](./FEATURES.md)
- [GETTING_STARTED.md](./GETTING_STARTED.md)
- [LOCAL_LLM.md](./LOCAL_LLM.md)
- [CURSOR_SUBSCRIPTION.md](./CURSOR_SUBSCRIPTION.md)
- [AGENT_MEMORY.md](./AGENT_MEMORY.md)
- [OBJECTTYPE_KERNEL.md](./OBJECTTYPE_KERNEL.md)
- [../CHANGELOG.md](../CHANGELOG.md)
- [../CONTRIBUTING.md](../CONTRIBUTING.md#what-we-are-looking-for-roadmap-themes)
