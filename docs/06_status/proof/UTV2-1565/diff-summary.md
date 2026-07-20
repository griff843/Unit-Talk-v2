# UTV2-1565 — Diff Summary

Issue: UTV2-1565
Tier: T2
Lane type: hygiene
Branch: `claude/utv2-1565-ghost-lane-reconciliation`

## Why this lane exists

Four lane manifests (UTV2-1424, UTV2-1446, UTV2-1546, UTV2-1551) were all
merged to `main` but never lane-closed, so each still read `status: started`
with a stale/null `pr_url`/`commit_sha`. `ACTIVE_LOCK_STATUSES` in
`scripts/ops/shared.ts` (used by `checkConcurrencyLimits`) counts `started`
as active, so these four ghost entries alone put the Claude executor cap
(4/4) and the governance lane-type cap (5/3) both over limit, blocking any
new lane start regardless of issue.

## Files changed

- `docs/06_status/lanes/UTV2-1424.json` — repaired from GitHub's authoritative
  merge state for PR #1265 (`ops:lane-manifest record-merge` +
  `ops:lane-close --repair-merged`; repair-packet content applied verbatim)
- `docs/06_status/lanes/UTV2-1446.json` — same, PR #1266
- `docs/06_status/lanes/UTV2-1546.json` — same, PR #1269
- `docs/06_status/lanes/UTV2-1551.json` — same, PR #1264
- `docs/06_status/lanes/UTV2-1565.json`, `.ops/sync/UTV2-1565.yml`,
  `docs/06_status/proof/UTV2-1565/*` — this lane's own manifest and proof

## Why via a dedicated issue, not folded into one of the four

`ops:lane-close --repair-merged`, run from the root checkout on `main`,
correctly refused to let the tracked-file changes land directly on `main`
(`guardRepairAgainstMainCheckout`) and printed the governed repair path for
each issue separately. Bundling all four repairs under any single one of
the four original issue numbers would have produced a branch name
referencing four different issues, violating the "one issue → one lane →
one branch → one PR" invariant and breaking every CI check that resolves
tier/scope by parsing a single issue ID out of the branch name
(tier-label-check, merge-gate's manifest lookup, file-scope-guard,
r-level-check). A new dedicated issue (UTV2-1565) is the correct home for
a batch of otherwise-unrelated lane-close repairs — this mirrors the
existing precedent at UTV2-1548 ("Lane-close manifest repair: UTV2-1517 +
UTV2-1523").

## Executed directly from the root checkout, not a worktree

This lane's own manifest honestly declares `worktree_path` as the repo
root and `main_checkout_control_only: false`, rather than fabricating a
worktree that was never created. The concurrency cap that blocked
`ops:lane-start` from provisioning a real worktree for this exact lane is
the same cap this lane's changes exist to relieve — a real worktree could
not be provisioned until after this fix lands. No runtime, domain, or DB
code is touched by this lane; the change is limited to lane-manifest JSON
metadata.
