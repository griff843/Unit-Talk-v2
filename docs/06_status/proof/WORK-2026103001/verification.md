# PROOF: WORK-2026103001

MERGE_SHA: pending merge

Issue: WORK-2026103001
Tier: T2
Lane type: hygiene
Execution SHA: `8642030a7f112382a7ee6c9514b6069c8212120a`
result: local_static_pass

## ASSERTIONS:

- [x] **Cause measured on staging** (`xskgrzbteyqdufktjrjx`, read-only `EXPLAIN (ANALYZE, BUFFERS)`, 2026-10-30).
  - Both fixture lookups in this suite filter `picks` on `selection`, which has no index. Each one is a full scan of about 181k retained rows: 1880 ms for `=`, and up to 5941 ms for the leading-wildcard `like` (`pg_stat_statements` max).
  - PostgREST's `authenticator` role has `statement_timeout=8s`. The `=` lookup's own `pg_stat_statements` maximum is 7694 ms.
  - Run 40996055001 failed 57014 on it in attempts 2 and 3. Attempt 3 ran with no other ci.yml run active.
- [x] **Fix:** both lookups now read `capper_id`, which is indexed by `idx_picks_capper_id`. The outsider lookup measured 6 ms.
- [x] **Not weakened.**
  - Test 3 previously checked one exact selection string. It now asserts zero picks for the run-namespaced outsider capper under *any* selection.
  - Test 4's `>= 2` run-fixture assertion and its "never member-visible" loop are unchanged. Every run fixture is created by CAPPER.
- [x] **Positive control:** tests 1 and 2 now assert that the persisted pick's `capper_id` equals CAPPER, read back through PostgREST. If the submit path stopped writing `capper_id`, they would fail before the zero in test 3 could pass vacuously.
- [x] **No change to production code.** That includes `listMemberVisibleOfficialPicks`, the submit handler and the auth/allow-list logic. There is also no schema change, data deletion, timeout change or skip.

## EVIDENCE:

Staging plans (before = current query, after = replacement):

```text
select id from picks where selection = '<run>'          Seq Scan, 181,870 rows removed   1880.596 ms
select id from picks where capper_id = '<outsider>'     Index Scan idx_picks_capper_id      5.923 ms
pg_stat_statements: selection = $1   calls 507  mean 1387 ms  max 7694 ms
pg_stat_statements: selection like $1 calls 438 mean  115 ms  max 5941 ms
authenticator statement_timeout = 8s
```

Staging persists capper_id on this suite's fixtures (prior runs, read-only):

```text
t1-proof-2801-utv2-1630-40996055001-3  ... ML track-only  validated
t1-proof-2801-utv2-1630-40996055001-3  ... ML delivery    queued
```

Remaining cost (not changed here): the member read takes 3528 ms on staging (`picks_status_idx`, 30,767 posted/settled rows removed by the JSON-path filters). A partial index would fix it. That is DDL and needs separate authorization.

## Verification

- [x] `pnpm type-check`: exit 0 on the execution SHA.
- [x] `pnpm exec eslint apps/api/src/t1-proof-work-2026092802-track-only-intent-live.test.ts`: exit 0.
- [x] `pnpm exec tsx --test apps/api/src/t1-proof-work-2026092802-track-only-intent-live.test.ts`: 5 skipped locally (no staging target, by design). The suite runs in CI's `Writable DB proof (staging only)` job.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: Verdict PASS, no R-level artifacts required for this diff.
- [ ] `pnpm verify` (which runs `pnpm type-check` and `pnpm test`) in CI on the PR head, including the staging live proof: pending.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1806
