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

Agents complete the ship cycle with structured tools: `git_status`, `git_diff`, `git_branch`, `git_checkout`, `git_add`, `git_commit`, `git_push`, plus `git_clone`, `github_pr_create`, and the GitHub Releases loop (`github_release_prepare` / `github_release_create` draft-first / `github_release_publish` / `github_release_list`) when Vault GitHub Connect is linked. Commit, push, clone, PR create, and release create/publish show a confirm preview. Push and release submit never auto-approve, including full autonomy, and never force-push.

For wide questions, `explore_coding` (or `delegate_to_subagent` with `mode=explore`) returns a read-only handoff. The parent implements edits under Authority. Explore timeouts land in Attention.

Deny a confirm or use the Authority coding kill switch to stop the cycle.

Automations can gate coding with event types `coding.file.before` / `coding.shell.before` (action **Gate**) and react after `coding.file.written` / `coding.shell.ran`. Set `CODING_HOOK_EXECUTION=off` to keep Automations discovery-only. Disk IDE `hooks.json` is not executed.

## What is not here

- GodMode is not a git forge. Host auth and review requests use Vault **Connect GitHub** (same token as Projects sync) for github.com HTTPS remotes.
- SSH remotes (`git@`) are not the SaaS default. Prefer HTTPS remotes with Connect or credentials already on the host.

See [[plugin-pipeline]] and [[git-github-plugins]].
