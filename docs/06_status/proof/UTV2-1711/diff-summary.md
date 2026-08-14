# UTV2-1711 Diff Summary

MERGE_SHA: d09b50700f9bb956cf48e568a1ad02ffc3b0d874

Issue: UTV2-1711  
Tier: T2  
Branch: `codex/utv2-1711-execution-epoch-truth`  
Implementation baseline: `53cee2f4f4e10d7141c0983091a2bc0ec6b7dc70`

## Summary

- Introduced schema-v2 execution checkpoints with explicit fresh, resume, and rework epochs. Each epoch owns an immutable implementation baseline, while attempts separately record their start SHA.
- Added checksummed primary and recovery-sidecar persistence with explicit read provenance and stale identity rejection.
- Made execution truth fail closed with named non-success results when checkpoint state, corroboration, phase progression, source changes, or rework changes are missing.
- Required the epoch baseline to be an ancestor of `HEAD` before Git diff corroboration can succeed.
- Bound executor mutations to the originating epoch/attempt identity and serialized clear/start/mutation transitions with one exclusive checkpoint lock.
- Added production-path tests using real temporary Git repositories and persisted checkpoint files, including resume, rework, recovery, mutation, and clear-state boundaries.

## Files changed

- `scripts/ops/execution-checkpoint.ts`: schema-v2 epoch model, integrity sealing, recovery, originating-executor identity checks, rework semantics, and atomic transition locking.
- `scripts/ops/execution-checkpoint.test.ts`: checkpoint coverage for immutable baselines, new epochs, recovery, stale executor rejection, and clear/start serialization.
- `scripts/ops/codex-exec.ts`: persisted-state evaluation, named fail-closed result codes, ancestor-validated Git corroboration, child identity transport, and explicit rework handling.
- `scripts/ops/codex-exec.test.ts`: end-to-end truth tests against real and divergent Git history plus on-disk checkpoint state.
- `.ops/sync/UTV2-1711.yml`: registers the required proof bundle.
- `docs/06_status/proof/UTV2-1711/*`: records implementation, routing, and verification evidence.

## Scope

All changes are within the lane packet's allowed file scope. No runtime application, contract, domain, database, migration, or generated database-type files changed.
