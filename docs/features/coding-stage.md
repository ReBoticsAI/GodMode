---
slug: coding-stage
title: "Coding stage"
section: "Productivity"
location: "/coding"
summary: "File tree, git status and diff, terminal, and agent git tools on the coding root."
---
# Coding stage

The Coding page (`/coding`) is the human surface for the same sandboxed coding root agents use.

## What is here

- **Files:** browse, create, edit, rename, and delete in the active coding root.
- **Git:** branch, dirty/ahead summary, and unstaged diff. Refresh after agent edits.
- **Terminal:** sandboxed one-shot commands and shared PTY sessions (when policy allows).

Agents complete the ship cycle with structured tools: `git_status`, `git_diff`, `git_branch`, `git_checkout`, `git_add`, `git_commit`, `git_push`. Commit and push show a confirm preview. Push never auto-approves, including full autonomy, and never force-pushes.

Deny a confirm or use the Authority coding kill switch to stop the cycle.

## What is not here

- GodMode is not a git forge. Host clone/auth and review-request tools stay on Official git-host connectors or plugins.
- SSH remotes (`git@`) are not the SaaS default. Prefer HTTPS remotes with credentials already on the host.

See [[plugin-pipeline]] and [[git-github-plugins]].
