# Shared federation

Share live resources (divisions, agents, models, plugin-backed pages) across separate GodMode homes.

![Shared network panel](assets/readme/shared.png)

## Same Bridge

Grants live in `core.sqlite`. Share by user email from any resource's share UI.

## Cross-home (Tailscale)

When owner and grantee run on different machines:

1. Install [Tailscale](https://tailscale.com/) on both hosts.
2. Open **Shared → Network** and click **Enable Tailscale URL** so Bridge advertises a MagicDNS federation URL.
3. Invite a teammate by email (Tailscale invite + pending peer row).
4. Owner creates a federated share invite (`POST /api/network/share-invites`) or shares by email.
5. Grantee pastes the owner bridge URL and invite token under **Accept federated share invite**.

Federation API (`/api/federation/*`) proxies SC commands, health checks, and live resource access over the tailnet.

## Health

Bridge refreshes peer health every five minutes and on demand via **Refresh peers**.

## Support for shared resources

Grantees open **Support → Shared resource owner** to reach the resource owner, not platform admins.

Full walkthrough: [VERIFICATION.md](./VERIFICATION.md)
