# Publisher / store console connector pattern

Handoff note for #446 (and consumers #445 / #444).

## Pattern

1. **Auth**: OAuth App / vendor CLI token / GitHub App user token.
2. **Vault**: store credentials under a stable secret id (or Connect card like GitHub). Never commit secrets.
3. **Tools**: prepare (stage) → submit (confirm, never auto-approve for irreversible publish) → list/metrics pull.
4. **Authority**: coding kill switch and/or deploy Authority; notify on success/failure (Attention/Notifications).
5. **Page**: Structure page kind or fixed route for status/metrics (do not overload Admin Updates).
6. **Teardown**: disconnect clears vault token.

## Near consumers

| Loop | Target | Status |
|------|--------|--------|
| #445 | GitHub Releases (draft-first) | Core Near proof on Vault GitHub Connect |
| #444 | One channel publish | Separate epic; reuse this pattern |

Further networks and app stores ship as Marketplace / Official plugins, not core identity.
