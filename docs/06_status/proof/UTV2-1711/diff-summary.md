# UTV2-1711 Diff Summary

MERGE_SHA: 4b74008920a3bc52b22f14507d60ba0232d5d439

Issue: UTV2-1711  
Tier: T2  
Branch: `codex/utv2-1711-execution-epoch-truth`  
Implementation baseline: `53cee2f4f4e10d7141c0983091a2bc0ec6b7dc70`

## Summary

- Introduced schema-v2 execution checkpoints with explicit fresh, resume, and rework epochs. Each epoch owns an immutable implementation baseline, while attempts separately record their start SHA.
- Added checksummed primary and recovery-sidecar persistence with explicit read provenance and stale identity rejection.
- Made execution truth fail closed with named non-success results when checkpoint state, corroboration, phase progression, source changes, or rework changes are missing.
- Added production-path tests using real temporary Git repositories and persisted checkpoint files, including resume, rework, recovery, mutation, and clear-state boundaries.

## Files changed

- `scripts/ops/execution-checkpoint.ts`: schema-v2 epoch model, integrity sealing, recovery, identity checks, rework semantics, and guarded clearing.
- `scripts/ops/execution-checkpoint.test.ts`: checkpoint unit and persistence coverage for immutable baselines, new epochs, recovery, stale identity, and active-attempt clearing.
- `scripts/ops/codex-exec.ts`: persisted-state evaluation, named fail-closed result codes, Git corroboration from the epoch baseline, and explicit rework handling.
- `scripts/ops/codex-exec.test.ts`: end-to-end truth tests against real Git history and on-disk checkpoint state.
- `.ops/sync/UTV2-1711.yml`: registers the required proof bundle.
- `docs/06_status/proof/UTV2-1711/*`: records implementation, routing, and verification evidence.

## Scope

All changes are within the lane packet's allowed file scope. No runtime application, contract, domain, database, migration, or generated database-type files changed.
