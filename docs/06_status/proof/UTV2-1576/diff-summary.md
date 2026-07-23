# Diff summary: UTV2-1576

## Capability fix (root cause)

- `scripts/ops/lane-close.ts` -- adds `isTrustedPostMergeAutomation()` and wires
  a `trustedPostMerge` option through `guardRepairAgainstMainCheckout()` and
  `main()`.
- `scripts/ops/lane-close.test.ts` -- 11 new tests covering the trusted-context
  invariants (all pass, plus all 69 pre-existing tests unchanged).
- `.github/workflows/post-merge-lane-close.yml` -- passes `--post-merge-trusted`
  to `ops:lane-close --repair-merged`; adds a fail-closed scope guard step
  before the commit step.

## Reconciliation (enabled by the fix above)

- `docs/06_status/lanes/UTV2-1560.json`, `docs/06_status/proof/UTV2-1560/evidence.json`
- `docs/06_status/lanes/UTV2-1573.json`, `docs/06_status/proof/UTV2-1573/{evidence.json,verification.md}`
- `docs/06_status/lanes/UTV2-1575.json`, `docs/06_status/proof/UTV2-1575/{evidence.json,verification.md}`

## This lane's own governed artifacts

- `.ops/sync/UTV2-1576.yml`
- `docs/06_status/lanes/UTV2-1576.json`
- `docs/06_status/proof/UTV2-1576/{evidence.json,verification.md,diff-summary.md}`

## Explicitly excluded

- UTV2-1571 manifest/proof/sync (untouched, remains active)
- UTV2-1574 manifest/proof (reverted to exact `main` content)
- PR #1297 / UTV2-1550
- Governance-cap / concurrency-limit logic
- Product/runtime code
- Branch protection or repository settings
