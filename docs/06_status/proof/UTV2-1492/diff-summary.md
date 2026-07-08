## Summary

UTV2-1492 tightens the preflight proof lifecycle for T2 governance lanes.

## Evidence

Branch: `codex/utv2-1492-preflight-proof-lifecycle`
Pre-commit SHA binding: `bb3a3689eae77ec9864c258a5f0ae47dcee81377`

Changed files:

- `scripts/ops/lane-start.ts` now writes manifest `expected_proof_paths` into `.ops/sync/UTV2-###.yml` so sync metadata carries the same proof lifecycle as the lane manifest.
- `scripts/ops/preflight.ts` now applies the `pnpm test:db` proof-auditor executed-command requirement only for T1 lanes. T2 proof directories can be audited without being forced through a T1 live-DB proof command.
- `.ops/sync/UTV2-1492.yml` was backfilled to match the fixed lane-start output for this active lane.

No runtime, database, migration, contract, domain, worker, or app code changed.

## Verification

Verification is recorded in `docs/06_status/proof/UTV2-1492/verification.md`.
