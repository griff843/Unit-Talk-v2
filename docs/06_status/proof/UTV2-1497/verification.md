# PROOF: UTV2-1497
MERGE_SHA: fd3f50d7c95e26e353f3857ec2684d1ff8ad99f7

## Verification

## Scope

Live-DB proof that concurrent `claimNextAtomic` calls against the same
`distribution_outbox` target never double-claim a row and never drop a row,
per the Linear issue's own plan-gate spec:

> Add a live-DB test (`pnpm test:db` scope) that spins up N concurrent
> `claimNextAtomic` calls against rows for the same target and asserts no
> row is claimed twice and no row is dropped. No production code change
> expected unless the concurrent test surfaces an actual race — if it does,
> stop and report before altering claim logic.

The concurrent test ran clean against real Postgres with zero races
surfaced. **No production code was touched in this lane** — `claim_next_outbox`
(the Postgres RPC backing `DatabaseOutboxRepository.claimNextAtomic`, which
already used `SELECT ... FOR UPDATE SKIP LOCKED`) is unmodified.

ASSERTIONS:
- [x] 12 concurrent workers racing via `Promise.all` against 8 enqueued outbox rows for one target — every row claimed by exactly one worker
- [x] The 4 excess workers (12 callers vs 8 rows) correctly receive `null` (no row left), never a duplicate claim
- [x] Claimed set exactly equals the enqueued set — no row dropped, none claimed twice
- [x] Each successful claim transitions the row to `processing` and records a distinct `claimed_by` worker id
- [x] No production code changed — `claim_next_outbox` RPC / `claimNextAtomic` untouched
- [x] `pnpm verify` green on this branch

EVIDENCE:
```text
$ UNIT_TALK_APP_ENV=local npx tsx --test apps/worker/src/t1-proof-utv2-1497-outbox-concurrent-claim.test.ts
TAP version 13
# Subtest: [live-db] concurrent claimNextAtomic calls never double-claim or drop a row
ok 1 - [live-db] concurrent claimNextAtomic calls never double-claim or drop a row
  ---
  duration_ms: 848.366537
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
# duration_ms 1701.024323
```

```text
$ pnpm verify
(exit code 0 — full static + live-db verify pipeline green on this branch,
2026-07-14)
```

```text
$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 6
Rules matched: lifecycle-fsm

Advisory (PM-gated) artifacts missing:
  - r4-fault-report [PM-gated]
```

## Round 2 — wire the test into the permanent regression suite

The PR's advisory "Return Review Packet" check (`test_wiring`) correctly
flagged that the new test file was not wired into any `pnpm` test script —
it would never run again automatically after this lane closes. The issue's
own plan-gate spec scopes this as a "`pnpm test:db` scope" test, so leaving
it unwired left that criterion only partially met.

Fixed by adding the test to `test:t1-proof:live` (consumed by
`pnpm test:live-db` → `pnpm verify`), matching the wiring convention used by
the other `apps/*/src/t1-proof-*.test.ts` files that already are wired in
(e.g. `t1-proof-utv2-1327-promotion-enrichment.test.ts`). `package.json` was
outside this lane's original `file_scope_lock`; authorized via a
`scope-override/v1` PR comment.

```text
$ UNIT_TALK_APP_ENV=local pnpm test:t1-proof:live
(...)
TAP version 13
# Subtest: [live-db] concurrent claimNextAtomic calls never double-claim or drop a row
ok 1 - [live-db] concurrent claimNextAtomic calls never double-claim or drop a row
1..1
# tests 1
# pass 1
# fail 0
```

```text
$ pnpm verify
(exit code 0 — full pipeline green with the new test wired into
test:t1-proof:live)
```

## Acceptance criteria mapping

| Criterion | Status |
|---|---|
| N concurrent `claimNextAtomic` calls against real Postgres rows for the same target | PASS — 8 rows, 12 concurrent callers raced simultaneously via `Promise.all` (see test body) |
| No row claimed twice | PASS — claimed-id set size equals row count, no duplicates |
| No row dropped | PASS — claimed set exactly equals enqueued set |
| No production code change unless a race surfaced | PASS — no race surfaced, `claim_next_outbox` / `claimNextAtomic` untouched |

## Merge SHA binding

Merged via PR #1221, squash merge commit `fd3f50d7c95e26e353f3857ec2684d1ff8ad99f7`.
Head SHA at merge: `fd7794cce7cc741d2474eec7542af1ead3af5ed9`.
