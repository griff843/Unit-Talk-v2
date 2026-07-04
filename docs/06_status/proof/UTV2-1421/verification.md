# PROOF: UTV2-1421 Verification

Issue: UTV2-1421
Tier: T2
Branch: codex/utv2-1421-lane-finalize-tier-label-fail-closed
MERGE_SHA: 513202a043c82913ab2ae74cc0f82fc020dc33a0

The SHA above is the implementation commit; post-merge closeout rebinds proof to the squash-merge SHA via `ops:proof-generate --merge-sha`.

## ASSERTIONS:

- [x] `apply_tier_label` step in `buildLaneFinalizePlan` is now `required: true` — lane finalize fails closed when the authoritative tier label cannot be applied to the PR
- [x] Finalize halts before proof generation on tier-label failure (step order asserted: `record_merge`, `apply_tier_label`)
- [x] Result surfaces `ok: false` with code `lane_finalize_failed` instead of silently skipping
- [x] `scripts/ops/lane-finalize.test.ts` updated: 10/10 pass
- [x] `pnpm type-check` and root `pnpm test` pass; r-level-check matches no rules

## EVIDENCE:

Commands run 2026-07-04 from the lane worktree.

```text
pnpm exec tsx --test scripts/ops/lane-finalize.test.ts
# tests 10
# pass 10
# fail 0
# skipped 0

pnpm type-check → PASS (tsc -b tsconfig.json, zero errors)
pnpm test → PASS (root aggregate suite)
npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
→ Verdict: PASS; no R1-R5 rules matched
```

## Verify blocker (environmental, out of scope)

`pnpm verify` fails only in `apps/ingestor/src/t1-proof-utv2-1282-bounded-dedup.test.ts` — a live-data precondition asserting SGO ingestion within a 72h window. The SGO API key has been inactive at the vendor since 2026-06-30 12:41 UTC, so the assertion fails on every branch. All static verify steps pass; `pnpm test:db` passed before the live-proof step. One additional flaky live test (`ingest-league-timeout.test.ts`) failed once and passed on immediate rerun. Neither failing file is in this lane's scope.
