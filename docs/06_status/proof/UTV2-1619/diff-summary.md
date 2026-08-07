# UTV2-1619 diff summary — close eligibility preflight

MERGE_SHA: f541fe51b1e781729385b9212ecd9a6d8a135cd1

- `truth-check-lib.ts`: added `evaluateCloseEligibilityPreflight` plus
  `hasBindableShaAnchor` and `evaluateModelRoutingSidecar`. The evidence checks call
  `evaluateT2ProofEvidence` — the same function the close gate runs for P11–P14 — so the
  merge and close paths share one decision model rather than two copies.
- Added `.github/workflows/close-eligibility-preflight.yml`: runs the module on
  `pull_request`, skips non-lane PRs, PR-scoped concurrency.
- 13 regression tests reconstructed from the lanes that actually merged un-closeable.

Checks are partitioned: pre-merge-knowable conditions block; merge-SHA reachability, CI on
the merge commit, and external mutation authorities are reported `not_knowable_pre_merge`
and never block.

No production, runtime, migration, or delivery path is touched. Not a required context.
