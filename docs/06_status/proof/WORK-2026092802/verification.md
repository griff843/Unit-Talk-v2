# PROOF: WORK-2026092802

MERGE_SHA: pending merge

Issue: WORK-2026092802
Tier: T1
Lane type: runtime
Branch: claude/work-2026092802-track-only-intent
result: pass

## ASSERTIONS:

- [x] **The production request shape now persists Track Only.** An authenticated, allow-listed
      capper under the production posture (posture on, capper on the allow-list, human target
      enabled, capper routing seeded) submits with `distributionMode: 'track-only'`, as pick
      `c12f1e2f` did on 2026-09-28. The pick persists `track-only`, is not `queued`, and creates
      0 outbox rows. The authorization record is `decision: 'refused'`,
      `reason: 'track-only-requested'` (Evidence 1, 3).
- [x] **Track Only creates no delivery artifact against real tables.** On staging there are 0
      `distribution_outbox`, 0 `distribution_receipts` and 0 `execution_intents` rows for that pick
      (Evidence 3, live test 1).
- [x] **A capper submission that declares no mode is Track Only** (Evidence 1).
- [x] **Explicit authorized delivery still works.** The same capper, under the same posture,
      requesting `delivery-eligible` gets exactly one pending outbox row on the human target, with
      0 receipts (Evidence 1, 3).
- [x] **Unauthorized delivery still fails closed.** Each of these returns 403
      `CAPPER_TRACK_ONLY_REQUIRED` and persists 0 picks:
      - a capper not on the allow-list requesting delivery
      - the containment posture (`CONTAINED_ENV`)
      - the allow-list set with the posture flag off
      - any mode other than `track-only` or `delivery-eligible`

      (Evidence 1, 3.)
- [x] **The regression test detects the defect.** On `main`'s handler it fails with
      `expected 'track-only', actual 'delivered'`. A mutation drill that restores the pre-fix block
      reproduces a queued delivery (Evidence 2).
- [x] **Existing guards are intact.** The UTV2-1672 `CAPPER_TRACK_ONLY_PIN_GUARD` mutation control
      and the source-pin, Smart Form contract, routing, exactly-once and recap-stop mutation
      controls all pass (Evidence 1).
- [x] **Unchanged:** kill switches, target registry, per-capper routing, outbox, worker, exactly-once
      enqueue, containment, and stripping of client-supplied authorization.

## EVIDENCE:

### 1. Unit and integration suites, head d04e63d75

```
apps/api/src/t1-proof-utv2-1923-human-capper-delivery.test.ts   # tests 49, pass 49, fail 0
apps/api/src/capper-delivery-authorization.test.ts              # tests 15, pass 15, fail 0
apps/api/src/http-integration.test.ts                           # tests 27, pass 27, fail 0
```

Section 7 of the 1923 suite:

```
ok 46 - WORK-2026092802: the production request shape — explicit Track Only from an allow-listed capper — persists Track Only
ok 47 - WORK-2026092802: an allow-listed capper who declares no mode is Track Only
ok 48 - WORK-2026092802: the same capper, same posture, asking for delivery still gets it
ok 49 - mutation control: restoring the pre-fix widening turns the production request into a queued delivery
```

### 2. The same tests against `main`'s handler

`apps/api/src/handlers/submit-pick.ts` was replaced with `origin/main`'s copy, the tests were run,
and the file was then restored with `git checkout`:

```
ok 1 - WORK-2026092802: a capper cannot request any mode other than track-only or delivery-eligible
not ok 2 - WORK-2026092802: the production request shape — explicit Track Only from an allow-listed capper — persists Track Only
not ok 3 - WORK-2026092802: an allow-listed capper who declares no mode is Track Only
not ok 4 - WORK-2026092802: the same capper, same posture, asking for delivery still gets it
  expected: 'track-only'
  actual: 'delivered'
```

Test 4 also fails on `main`. That is the other face of the same defect: `main` refused an explicit
`delivery-eligible` request with 403, so the Smart Form's delivery choice never worked.

### 3. Live staging proof, GitHub Actions

Run `36409289475`, job `Writable DB proof (staging only)` (`108885549999`), head `d04e63d75`. It
runs `pnpm test:t1-proof:live` behind `pnpm ci:assert-staging`, against staging
`xskgrzbteyqdufktjrjx`:

```
ok 1 - WORK-2026092802 live: the production request shape persists Track Only with zero delivery artifacts
ok 2 - WORK-2026092802 live: the same capper explicitly asking for delivery still gets one governed outbox row
ok 3 - WORK-2026092802 live: a capper not on the allow-list asking for delivery is refused and persists nothing
1..3
# tests 3
# pass 3
# fail 0
# skipped 0
```

The test refuses a URL containing the production ref.

**Fixture honesty.** The live test uses run-namespaced cappers, fixture snowflakes and the manual
`canonical-coverage-gap` path. Production pick `c12f1e2f` used the canonical path. The defect lived
only in the mode decision, which runs before and independently of participant resolution, so both
paths reach the same guard.

### 4. Test DB

`pnpm test:db` runs inside the required `verify` context. On run `36409289475`,
`Writable DB proof (staging only)` succeeded, and `verify` (job `108887505170`) succeeded and
verified its receipt. Staging only: no production credential is used and no production write is
made.

```
TAP version 13
# Subtest: WORK-2026092802 live: the production request shape persists Track Only with zero delivery artifacts
ok 1 - WORK-2026092802 live: the production request shape persists Track Only with zero delivery artifacts
ok 2 - WORK-2026092802 live: the same capper explicitly asking for delivery still gets one governed outbox row
ok 3 - WORK-2026092802 live: a capper not on the allow-list asking for delivery is refused and persists nothing
# pass 3
# fail 0
```

### 5. Production, read-only and untouched

Pick `c12f1e2f` (`queued`, `delivery-eligible`) and its outbox row `5005f461` were observed
read-only. They are not modified by this change, and fixing them is not part of it. Their
disposition is reserved to Griff. So is pick `2cc92f4b`. No kill switch was touched.

## Verification

```
pnpm exec tsx --test apps/api/src/t1-proof-utv2-1923-human-capper-delivery.test.ts   # tests 49, pass 49, fail 0
pnpm exec tsx --test apps/api/src/capper-delivery-authorization.test.ts              # tests 15, pass 15, fail 0
pnpm exec tsx --test apps/api/src/http-integration.test.ts                           # tests 27, pass 27, fail 0
pnpm exec tsx --test scripts/ci/required-db-smoke.test.ts                            # pass 12, fail 0 (db-writer inventory)
pnpm exec tsx scripts/ci/db-writer-inventory.ts                                      # ok: true, 58 credentialed tests, 0 errors
pnpm type-check                                                                      # exit 0
pnpm exec eslint <changed .ts files>                                                 # exit 0
pnpm test                                                                            # full suite inside required `verify`: success, run 36409289475
pnpm verify                                                                          # required `verify` job: success on run 36409289475, head d04e63d75
pnpm test:db                                                                         # inside `verify`: Writable DB proof (staging only) success, receipt verified
pnpm test:t1-proof:live                                                              # staging: 3/3 new live tests pass, 0 skipped
pnpm exec tsx scripts/ci/r-level-check.ts --base 777bc32e0 --head d04e63d75         # Verdict: PASS
```

Earlier local `pnpm verify` on identical code: 3398 of 3399 tests passed. The one failure was the
db-writer inventory, which this lane's classification entry fixes.

**Known residual, out of scope.** Some documents still describe the old "pins track-only"
behaviour:

- `apps/api/CLAUDE.md`
- `docs/03_product/smart-form/intent.md` §3.9
- the Smart Form `BetSlipPanel.tsx` copy

None of them is in this lane's scope.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1675
