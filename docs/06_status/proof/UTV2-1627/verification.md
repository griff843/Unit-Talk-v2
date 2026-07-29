# UTV2-1627 Verification

Source SHA: `5cfa98630c4b6051e2f53a54c4ecf422a6790bfa`

## Summary

CI, pull-request database smoke, and writable T1 proof workflows now require a separately named isolated Supabase credential set and an explicit `writable-isolated` access mode. The identity guard verifies the actual target URL and project ref, rejects the canonical production ref, and fails closed on missing or mismatched target identity.

The database-writer inventory classifies all 49 credentialed test entrypoints plus production read-only proof scripts and workflow execution paths. New unclassified writers, mutation-capable production-observation paths, or writable workflows using generic production secrets fail the inventory gate.

## Evidence

- Verified implementation commit: `5cfa98630c4b6051e2f53a54c4ecf422a6790bfa`
- Isolated Supabase branch: `ci-proof-isolated`
- Isolated project ref: `wgfgqfxnnwjmrbubqhcj`
- Canonical production ref: `zfzdnfwdarxucxtaojxm`
- Final UTV2-1497 run ID: `a3811138`
- Isolated receipt: 8 matching picks and 8 matching outbox rows.
- Production read-only receipt for run `a3811138`: 0 matching picks and 0 matching outbox rows.
- Production cleanup or mutation: none.
- Negative proof: a writable guard invocation using the canonical production URL was rejected.
- Writer inventory: 49 credentialed tests classified, 0 errors.

The isolated branch was built from the checked-in schema baseline and forward migrations, then seeded with the canonical reference rows required by DB smoke and proof execution. Repository secrets were created for `CI_SUPABASE_URL`, `CI_SUPABASE_ANON_KEY`, `CI_SUPABASE_SERVICE_ROLE_KEY`, and `CI_SUPABASE_PROJECT_REF`; secret values are not included in proof output.

## Verification

| Command                                                              | Result                                    |
| -------------------------------------------------------------------- | ----------------------------------------- |
| `pnpm type-check`                                                    | PASS via `pnpm verify`                    |
| `pnpm test`                                                          | PASS via `pnpm verify`                    |
| `pnpm test:db`                                                       | PASS — 7 passed, 0 failed, isolated ref   |
| `pnpm test:t1-proof:live`                                            | PASS via `pnpm verify`, isolated ref      |
| `pnpm exec tsx scripts/ci/db-writer-inventory.ts`                    | PASS — 49 classified                      |
| production identity negative proof                                   | PASS — canonical writable target rejected |
| `pnpm verify`                                                        | PASS                                      |
| `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS                                      |

Final `pnpm verify` output:

```text
# Subtest: [live-db] concurrent claimNextAtomic calls never double-claim or drop a row
ok 1 - [live-db] concurrent claimNextAtomic calls never double-claim or drop a row
  ---
  duration_ms: 1015.878543
  type: 'test'
  ...
1..1
# tests 1
# suites 0
# pass 1
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1859.693807
```

R-level output:

```text
Verdict: PASS
Changed files: 22
Rules matched: lifecycle-fsm

Advisory (PM-gated) artifacts missing:
  - r4-fault-report [PM-gated]
```

The proof bundle is intentionally pre-merge. The merge SHA must be appended during post-merge lane finalization.
