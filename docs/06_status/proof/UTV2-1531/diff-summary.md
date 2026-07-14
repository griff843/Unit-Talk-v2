# UTV2-1531 Diff Summary

## Summary

Resolves DEBT-030 and DEBT-031 in lane file-scope enforcement.

## Files changed

- `scripts/ops/shared.ts` — permits the file-scope guard's supported trailing `/**` directory lock, verifies its directory exists, and treats bracketed route segments as literal path characters. Other glob syntax remains rejected.
- `scripts/ops/shared.test.ts` — covers supported glob locks, literal Next.js-style `[id]` paths, unsupported glob rejection, and manifest validation.
- `scripts/ci/file-scope-guard.ts` — excludes manifests under `docs/06_status/lanes/parked/` from trusted active-lane scope evaluation.
- `scripts/ci/file-scope-guard.test.ts` — proves a parked manifest cannot generate a cross-lane file-scope conflict.

## Scope

No application runtime, database, domain, contract, migration, or delivery paths changed.
