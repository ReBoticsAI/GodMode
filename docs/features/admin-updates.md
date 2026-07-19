---
slug: admin-updates
title: "Admin Updates"
section: "Platform and agents"
location: "/settings/admin?tab=updates"
summary: "Stable/nightly channels, signed release checks, defer/skip, host-supervisor apply."
---

# Admin Updates

Admins choose a release channel (stable or nightly), review signed release availability, and defer or skip updates. When a host supervisor is installed, apply can restart services into the new package.

## Route

`/settings/admin?tab=updates`

## Agent notes

- Prefer reading release notifications from the platform alerts surface.
- Do not claim an update applied unless the host supervisor status confirms it.
