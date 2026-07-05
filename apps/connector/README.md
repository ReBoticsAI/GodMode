# GodMode Local Connector

Thin native process for **hardware-bound marketplace plugins** (local desktop apps, GPU workloads, device integrations). The platform core runs in Docker or on your VPS; this connector runs on the user's machine and forwards commands to the local Bridge federation API.

## Setup

```bash
cd apps/connector
npm install
export BRIDGE_URL=http://127.0.0.1:3847
export FEDERATION_TOKEN=<token from Shared grant or bridge connection>
npm run dev
```

Health: `GET http://localhost:3950/health`

Execute: `POST http://localhost:3950/execute` with plugin-specific payload (see your plugin's connector manifest).

Domain packs published on the marketplace include a connector manifest and setup readme — not part of the default new-user workspace.
