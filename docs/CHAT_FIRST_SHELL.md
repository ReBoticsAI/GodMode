# Chat-first shell (Graph UI retired)

Signed-in home is a Discord/Slack-style chat app, not The Graph.

## Layout

- Left / directory: channels, DMs, agents (inside Intelligence shell chat)
- Center: conversation + composer (`IntelligencePanel` `layout="shell"`)
- Right: context rail (Members / Knowledge / Approvals)
- Apps menu: Wiki, Tasks, Calendar, Vault, Settings, Structure, Marketplace, Admin

## Entry

- [`apps/web/src/components/chat-shell/ChatAppShell.tsx`](../apps/web/src/components/chat-shell/ChatAppShell.tsx)
- Wired from [`AppShell`](../apps/web/src/App.tsx) when path is `/home` (or `/`)

## Graph

The 3D Graph canvas is **retired from primary chrome**. Isolation / SQLite-universe work continues without Graph-as-navigation. See [STATE_GRAPH_ISOLATION.md](./STATE_GRAPH_ISOLATION.md) for storage/compute layers (not the map UI).

Tracking: GitHub epic #867.
