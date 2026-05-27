# Verification: UTV2-1119 — Rollback Runtime (INIT-3.2.4)

## Verification

- **Tier:** T1
- **Verifier:** claude-sonnet-4-6 (orchestrator)
- **Implementation SHA:** 044bab2539fb567bc076f2fc89ae0defc22c4303
- **Merge SHA:** set-by-ci

## Static proof

| Check | Result |
|---|---|
| pnpm verify | PASS (113/113 tests) |
| type-check | PASS |
| lint | PASS |
| build | PASS |
| R-level check | PASS (no R-level artifacts required) |

## Live-DB proof

`pnpm test:db` — 7/7 PASS against live Supabase (`zfzdnfwdarxucxtaojxm`)

Duration: 29119 ms

## Implementation summary

`packages/domain/src/models/rollback-runtime.ts` implements INIT-3.2.4:

- `RollbackRecord` — append-only audit record for each rollback event
- `buildRollbackRecord()` — pure factory: status derived from propagated/verified/error state; defaults fail_open to true
- `RollbackPropagationVerification` — post-rollback SHA re-check result
- `verifyRollbackPropagation()` — pure verification: propagated flag + SHA match

**Dispatch constraints satisfied:**
- replay reconstruction: `buildRollbackRecord` is pure and deterministic
- append-only audit evidence: `RollbackRecord` fields are all `readonly`
- fail-open analysis: `fail_open: boolean` field; defaults to `true`
- rollback propagation verification: `verifyRollbackPropagation()` checks version + SHA

**15 tests** cover: initiated/propagated/verified/failed status transitions, failed-takes-precedence over verified, fail_open default + explicit override, all 5 trigger types, null coercion, determinism, propagated=true/false, sha_match=true/false/null.
