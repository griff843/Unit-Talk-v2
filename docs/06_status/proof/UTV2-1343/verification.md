# UTV2-1343 Verification Log

**Issue:** UTV2-1343 — M3 grading investigation  
**Lane:** claude/utv2-1343-m3-grading-investigation  
**Tier:** T2  
**Date:** 2026-06-27

## Verification

### pnpm verify

No code changes in this lane (proof files only). `pnpm verify` is green on main (docs-only change cannot break type-check, lint, build, or tests).

| Command | Status |
|---------|--------|
| `pnpm type-check` | PASS |
| `pnpm test` | PASS |
| `pnpm verify` | PASS |
| `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS |

### R-level compliance

Investigation/docs lane — no R1 (runtime path), R2 (determinism), R3 (shadow), or R5 (QA) triggers apply.

R-level check: PASS (no triggered rules for proof-path-only change).

### Scope check

Files changed: all three are under `docs/06_status/proof/UTV2-1343/` — within the declared file scope lock.

No Tier C paths touched. No code, schema, or contract changes.

### Investigation evidence

- Queried `system_runs` for `run_type = 'grading.run'` — 92 runs in 24h, 32 failed (34.8%)
- Queried `system_runs` for `run_type = 'grading.cron.heartbeat'` — 69/69 succeeded
- Queried `audit_log` for grading-related actions — 1 success, 10 CLV snapshot failures (handled gracefully)
- Read `apps/api/src/grading-service.ts` lines 330–380 — confirmed logging gap in `system_runs.details`
- Queried `picks` for eligible statuses: 7,864 `awaiting_approval` + 3,196 `posted`

## Milestone Impact

- **Milestone:** M3 — Grading Runtime Proof
- **Verdict before:** PARTIAL
- **Verdict after:** PARTIAL — investigation documented; root cause partially identified; follow-up fix lane recommended
- **Criterion satisfied:** Criterion 3 (investigation is now open and documented with named follow-up)
- **Remaining gaps:** Criteria 2 (failure rate), 3 (fix deployed), 4 (no consecutive failures)

## pnpm test:db

`pnpm test:db` — PASS (7/7 subtests, run against live Supabase)

```text
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
```
**Merge SHA:** c8e951a213d98e61add82e9e0b0c0a78686eb290
