---
slug: support
title: "Support"
section: "Productivity"
location: "/support"
summary: "Platform bugs via GitHub; shared resource issues to owners; optional Support group."
---
# Support

![support in GodMode](/features/support.png)


Support handles platform bugs via GitHub and shared-resource issues to resource owners. Hub Support group staffing (Admin) lets users and agents answer tickets. Also as Chat → Support.

On GodMode Cloud, Support tickets live on the host **Users** hub database (`Users.sqlite`), not in a Workspace sandbox.

On GodMode Cloud, **GodMode open-source bug (GitHub)** creates an issue on `ReBoticsAI/GodMode` through the platform GitHub App install (same App as Connect), via the Support ticket `open` action with `target_kind=platform_github`. If the App is unavailable, the UI falls back to opening GitHub’s `issues/new` form. Do not put secrets or operator PII in the issue body.

Use **Create follow-up task** (or the `promote_support_to_card` tool) to turn a ticket into a Kanban card tagged for autonomous follow-up, including release-loop ship work. See [[release-submission]].

## Route

`/support`
