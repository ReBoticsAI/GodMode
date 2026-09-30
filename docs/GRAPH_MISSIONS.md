# Graph missions

Gamified attention loop on The Graph. Nodes with open missions show a notification dot. You visit a node, finish the mission work, then claim points. Scores publish to a **global leaderboard on GodMode Cloud**.

## Rules

- Points are awarded **once per mission completion**, not for visit alone.
- Reward: `max(1, round(basePoints * (1 + outboundEdges + uniqueChildren)))` from the architecture catalog (same formula on every instance).
- Completions are idempotent per `(user_id, mission_id)`.
- Server re-checks mission predicates before awarding.
- Local guest scores stay on the user SQLite-universe file; Cloud publish requires a real signed-in user id.

## Storage

| Layer | Where | Holds |
|-------|--------|--------|
| Mission defs | Code catalog (`graph-missions-catalog.ts`) | Titles, predicates, base points |
| Local score | `sqlite-universe/actors/users/<userId>.sqlite` | Completions + total |
| Global board | Cloud `graph_leaderboard_scores` / `graph_leaderboard_events` | Ranked users (display name) |

Missions are not memories. Memories are Knowledge facts. Mission completions are score ledger rows. Registry path links remain structural.

## Where to see your score

- **Graph chrome** (bottom-left): total points badge.
- **Any node Information panel**: total score plus that node’s earned / available points and its missions.
- **You node**: full **scorecard** (every node’s earned vs available) plus per-mission rows and the global Cloud leaderboard.

## Meet Intelligence

Sending a chat message to Intelligence satisfies `chat_sent`. Bridge auto-awards on the next missions sync (after the turn finishes, or when you refresh missions status). You do not need to press Complete for that mission.

## API

- `GET /api/graph-missions` – open/done missions + attention counts
- `POST /api/graph-missions/:id/complete` – verify + award + Cloud upsert
- `GET /api/graph-missions/leaderboard` – top scores (display name + points only)

Architecture projection adds safe `status.attention` / `attentionCount` for glyphs.

## MVP missions

Claim You, Connect LLM keys, Open User Vault, Meet Intelligence, Open Structure, Open Knowledge, Hub check.
