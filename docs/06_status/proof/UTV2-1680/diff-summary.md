# PROOF: UTV2-1680

MERGE_SHA: ccd485646ad521b92b0e92c85c9d982866c6cc0d

# UTV2-1680 Diff Summary

- Issue: `UTV2-1680`
- Tier: `T2`
- Branch: `codex/utv2-1680-canonical-active-lane-resolver`

## Summary

- `ops:execution-state` now resolves the canonical union of local manifests and open-PR-head manifests through `resolveActiveLaneManifests()` instead of reading only the current worktree.
- Active-lane summaries retain resolver provenance, manifest location, lifecycle capacity classification, source population, classification rule, and observation timestamp.
- Total, executor, and lane-type capacity metrics are computed from the resolver's per-lane `countsAgainst` matrix. Parked lanes remain visible but consume no capacity; blocked and review lanes remain visible while consuming only their configured dimensions.
- Every capacity metric is a labeled object containing `observed_at`, `source_population`, `classification_rule`, `used`, `max`, `available`, and `over_by`; a raw unlabeled capacity count is no longer exposed.
- Discovery failures propagate as `ActiveLaneDiscoveryError`; an unknown board cannot be reported as zero.

## Files changed

- `scripts/ops/execution-state.ts` — consumes canonical discovery, reports provenance and labeled capacity metrics, and preserves fail-closed discovery behavior.
- `scripts/ops/execution-state.test.ts` — covers canonical local/PR-head union reporting, parked-lane capacity, metric labeling, timestamps/rules, and discovery refusal.
- `docs/06_status/proof/UTV2-1680/verification.md` — records focused, static, live read-only, and deferred writable-DB verification.
- `docs/06_status/proof/UTV2-1680/model-routing.json` — records the selected Codex model profile.

## Live read-only result

At `2026-08-11T21:31:30.703Z`, `pnpm ops:execution-state -- --json` reported 10 canonical visible lanes: 7 counted against total capacity, 2 against Claude executor capacity, and 1 against Codex executor capacity. Three parked lanes were visible and explicitly classified `visible_uncounted`.

## Scope notes

No cap values, lifecycle rules, admission gates, runtime application code, contracts, migrations, or database state were changed.
