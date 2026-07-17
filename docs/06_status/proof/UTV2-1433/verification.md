# PROOF: UTV2-1433
MERGE_SHA: 728a41725a8df6bee5fa2b62ee36810ed2ed7a15

ASSERTIONS:
- [x] repairMergedLaneManifest's already-done early return also releases the lease if it's still marked active, but only when the caller opts in via releaseLocksIfAlreadyDone
- [x] Regression test: call repair-merged twice against an already-done manifest with an active lease; assert the lease is released after either call (opt-in path)
- [x] New regression test: default (no opt-in) leaves lease/merge-lock state untouched for an already-done manifest — addresses Codex P2 finding on helper-level default lock release
- [x] Only the CLI --repair-merged path passes releaseLocksIfAlreadyDone: true; no other caller changes behavior
- [x] model-routing.json proof sidecar present with real content (addresses second Codex P2 finding — this file already existed before that finding was raised; thread confirmed and resolved)
- [x] pnpm verify green end-to-end
- [x] pnpm test:db green (7/7 pass, live Supabase)
- [x] r-level-check PASS, no artifacts required for this diff

EVIDENCE:
```text
$ pnpm exec tsx --test scripts/ops/lane-close.test.ts
1..64
# tests 64
# pass 64
# fail 0

$ pnpm test:db
1..7
# tests 7
# pass 7
# fail 0

$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 7
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

`repairMergedLaneManifest`'s already-done early return calls `releaseCloseoutLocks` (lease + merge lock) before returning `already_closed`, matching the "safe to re-run" design intent of `--repair-merged` — but only when the caller passes `releaseLocksIfAlreadyDone: true`. This addresses a Codex P2 finding: the original version defaulted to touching the real `.ops/leases`/`.ops/merge-lock.json` state for any caller, which could throw `merge_lock_owner_mismatch` against an unrelated live lock or silently release live coordination state for a caller that only wanted a read-only check. Only the CLI's `--repair-merged` path opts in.

Regression tests in `scripts/ops/lane-close.test.ts` cover: (1) an active lease is released when the caller opts in and repair-merged hits an already-done manifest, (2) a second repair-merged call against the same manifest with opt-in is idempotent (no throw, no double-release error), and (3) the default (no opt-in) leaves lease state untouched.

A second Codex finding claimed `model-routing.json` was missing (only `.gitkeep` present at review time) — verified against the current head: `docs/06_status/proof/UTV2-1433/model-routing.json` exists with real content, added in a prior commit on this branch before the finding was raised. No action needed beyond confirming and resolving the thread.

## Commit binding

Head SHA: 728a41725a8df6bee5fa2b62ee36810ed2ed7a15
Merge SHA: pending — will be bound automatically by `post-merge-lane-close.yml`'s `ops:proof-generate --merge-sha` after merge, per repo convention.
