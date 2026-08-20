---
slug: git-github-plugins
title: "Git and GitHub plugins"
section: "Social and extension"
location: "Marketplace → Official"
summary: "Core local git cycle plus optional Official host and review-request tools."
---
# Git and GitHub plugins

![git-github-plugins in GodMode](/features/git-github-plugins.png)

Core already ships a local git cycle on the coding root (`git_status`, `git_diff`, `git_branch`, `git_checkout`, `git_add`, `git_commit`, `git_push`) plus Connect-backed host tools (`git_clone`, `github_pr_create`) when Vault **Connect GitHub** is linked. Use `/coding` Git to inspect diffs. Push, clone, and PR create require confirmation and never force-push.

Official Marketplace packs may still add vendor-specific helpers. They do not replace the core local cycle or Connect auth for github.com.

## Official connector quality bar

GitHub is the reference Official connector for
[OFFICIAL_CONNECTORS.md](../OFFICIAL_CONNECTORS.md):

| Concern | Where |
|---------|--------|
| Auth / refresh / disconnect | Vault **Connect GitHub** (`GithubIntegration` ObjectType actions; OAuth callback protocol exception) |
| Webhooks | GitHub App webhook HMAC on Bridge |
| Host tools | Core Connect-backed `git_clone` / `github_pr_create` |
| Official pack | Marketplace Official `godmode-plugin-github` (pinned install + capability grants) |
| Companion pack | Official `godmode-plugin-git` for extra local helpers |

Install from **Marketplace → Official**. Connect from Vault / AI Settings before relying on host tools.

See [[coding-stage]], [[marketplace]], and [[plugin-pipeline]].
