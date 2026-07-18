# Kernel product-parity snapshots

Regenerate (fail-closed against novel P0/split-brain debt):

```bash
npm run audit:kernel:parity
```

Optional live evidence:

```bash
node scripts/audit-kernel-parity.mjs --strict --evidence scripts/parity-report/smoke-evidence.json
```

`LATEST.*` are committed snapshots from the re-audit so the gap matrix is reviewable without regenerating. Prefer regenerating before fix PRs.

Known P0 debt is tracked in `OPEN_DEBT.json`. Strict audits fail on novel blocking findings or stale debt IDs. Recommendation: `restore_dual_model`.
