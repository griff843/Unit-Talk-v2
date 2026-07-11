# UTV2-1516 Verification

## Verification

Commands run:

- `pnpm type-check` — PASS
- `pnpm test` — PASS
- `pnpm ops:lane-maximizer -- --json` — PASS; output includes `dispatch_plan.lane_saturation_forecast.full_verify_throttle` with `max_concurrent: 1`, `active: 0`, `available_slots: 1`
- Stale slot check — PASS; a temporary 7-hour orphaned `.out/ops/preflight/full-verify-semaphore/slot-0` directory was ignored by `lane-maximizer` and then removed
- `pnpm verify` — PASS; includes `pnpm test:db` and `pnpm test:t1-proof:live`
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS

```text
Verdict: PASS
Changed files: 12
Rules matched: (none) — no R-level artifacts required for this diff
```

## Runtime Verification

Command executed: `pnpm test:db`

```
TAP version 13
# Subtest: database repository bundle persists a submission and settlement when Supabase is configured
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 126234.806897
```

Supabase project: `zfzdnfwdarxucxtaojxm`. Pure CI-tooling change (throttle helper in `scripts/ops/preflight.ts`); no DB writes attributable to this lane's own change set.

Verification SHA: `0131652fdb6c1d97cbb252b9bf990d541d5573ed`
Verified at: `2026-07-11T13:05:00.000Z`
