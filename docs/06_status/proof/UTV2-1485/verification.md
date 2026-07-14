# UTV2-1485 Verification

**Commit SHA:** ca0c2c59fa2a190229f84811c9036c59cca349f5 (this proof commit's parent — exact HEAD SHA cannot be embedded pre-commit; `post-merge-lane-close.yml` rebinds to the merge SHA automatically after merge)

## Verification

- `pnpm type-check`: PASS — root project-reference type check completed with no errors.
- `pnpm test`: PASS — full repository test suite completed successfully.
- `npx tsx --test apps/command-center/src/lib/alert-builder.test.ts`: PASS — 10 tests passed.
- `pnpm verify`: PASS — environment, lint, type check, build, test, and live-DB gate completed successfully.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS — `operator-ui` matched; no additional artifact was required by the check.

## Issue-Specific Verification

The focused tests prove that valid internal alert definitions can be restored from browser storage, while malformed JSON, malformed entries, and entries whose governance flags are changed are ignored. Existing validation continues to require sport, market, and at least one threshold.

No live database test is applicable: this T2 change contains no database, API service, migration, worker, or runtime delivery changes.

- `pnpm test:db` — PASS (7/7), required unconditionally by `proof-auditor-gate.ts` regardless of tier:

```
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
```
