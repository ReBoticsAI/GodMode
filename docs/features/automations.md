---
slug: automations
title: "Automations"
section: "Productivity"
location: "Chat panel → Automations tab"
summary: "Same kanban board in Chat; auto tags drive the autonomous runner."
---
# Automations

![automations in GodMode](/features/automations.png)


Automations use the same kanban board as Tasks, surfaced inside the Chat panel. Tag `auto` for the autonomous runner.

Hook definitions, `hook_runs`, and the PlatformEvent trigger log (`platform_events`) live in the **Workspace** database. Emitting a PlatformEvent requires a Workspace id. The Workspace durable outbox table also named `events` is a different subsystem.

See [[tasks]].
