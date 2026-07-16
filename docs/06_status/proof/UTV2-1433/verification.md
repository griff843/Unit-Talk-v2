# PROOF: UTV2-1433
MERGE_SHA: 55af542309836cc4c20c2ba8e3c7966891e1b77c

ASSERTIONS:
- [x] repairMergedLaneManifest's already-done early return also releases the lease if it's still marked active
- [x] Regression test: call repair-merged twice against an already-done manifest with an active lease; assert the lease is released after either call
- [x] pnpm verify green end-to-end
- [x] pnpm test:db green (7/7 pass, live Supabase)
- [x] r-level-check PASS, no artifacts required for this diff

EVIDENCE:
```text
$ npx tsx --test scripts/ops/lane-close.test.ts
1..63
# pass 63
# fail 0

$ pnpm test:db
1..7
# tests 7
# pass 7
# fail 0

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 6
Rules matched: (none)
```

# UTV2-1433 Verification

## Verification

| Check | Result |
| --- | --- |
| `npx tsx --test scripts/ops/lane-close.test.ts` | Passed — 63/63 |
| `pnpm type-check` | Passed |
| `pnpm test` | Passed |
| `pnpm verify` | Passed |
| `pnpm test:db` | Passed — live database repository smoke test against real Supabase (7 tests, 0 failures) |
| `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | Passed — Verdict: PASS, 6 changed files, no R-level artifacts required for this diff |

`pnpm test:db` node:test result:

```text
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

## Issue-specific verification

`repairMergedLaneManifest`'s already-done early return now also calls `releaseCloseoutLocks` (lease + merge lock) before returning `already_closed`, matching the "safe to re-run" design intent of `--repair-merged`. Regression test in `scripts/ops/lane-close.test.ts` covers: (1) an active lease is released when repair-merged hits an already-done manifest, and (2) a second repair-merged call against the same manifest is idempotent (no throw, no double-release error).

## Commit binding

Head SHA: fbb911a6fddf5ae646858f705af6878b3777285f
Merge SHA: pending — will be bound automatically by `post-merge-lane-close.yml`'s `ops:proof-generate --merge-sha` after merge, per repo convention.
