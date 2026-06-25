# UTV2-1313 Readiness Score Refresh — Verification

**Date:** 2026-06-25  
**Branch:** codex/utv2-1313-readiness-score-refresh  
**Tier:** T2 (governance/docs only)  
**Lane type:** governance

## Verification

This is a T2 governance/docs-only lane. No code changes. Verification consists of:
1. Confirming live truth sources for each dimension
2. Updating readiness-score.json with accurate values
3. `pnpm type-check` and `pnpm test` green on the branch (no code changed, pass by default)

### Dimension-by-Dimension Evidence

| Dimension | Status | Evidence Source | Verdict |
|---|---|---|---|
| `deploy_sha_alignment` | PASS | Deploy run on 2026-06-25 aligned prod SHA 1104ea47 to main HEAD | Resolved |
| `ingestor_health` | FAIL | 8 post-restart cycles all fail at markClosingLines with statement_timeout; provider_offer_history scans 60+ partitions with no lower-bound on snapshot_at | Active blocker |
| `worker_outbox_health` | PASS | 343 canary rows draining (sent 2026-06-25T09:29); 235 Mode 1 best-bets suppressed by governance hold (expected); retrying=0; true stuck rows=0 | Resolved (prior audit misclassified governance holds as stuck) |
| `dead_letter_count` | PASS | 946 DL rows all have attempt_count=0 and governance brake reason codes (610 t1-proof canary, 336 Mode 1 best-bets); zero rows with retry-exhausted status; true delivery failures=0 | Resolved (Phase 7A governance holds correctly classified) |
| `db_tripwires` | PASS | G-CONST-12 closed, G-CONST-13 closed; G-CONST-11 PM-deferred (retention execution not a critical blocker) | Resolved |
| `pnpm_verify` | PASS | CI green on main SHA 1104ea47 as of 2026-06-25 merge | Resolved (was 'unknown' at prior audit — CI completed green) |
| `proof_coverage` | PASS | 5 SHA-bound proof bundles created 2026-06-25, all tied to merge SHAs | No change |
| `constitution_convergence` | FAIL (non-blocking) | ~68% convergence, threshold 80%; non-blocking per program policy | No change |

### Files Modified

- `docs/06_status/readiness/readiness-score.json` — updated all dimension statuses, scalar fields, blockers array, open_gap_count, and verdict
- `docs/06_status/proof/UTV2-1313/diff-summary.md` — diff narrative
- `docs/06_status/proof/UTV2-1313/verification.md` — this file

### R-Level Compliance

R-level check: PASS — governance/docs only lane. No code artifacts, no DB migrations, no T1 runtime proof required.

### pnpm test:db

Run against live Supabase (`zfzdnfwdarxucxtaojxm`) in lane worktree — 7/7 pass:

```
TAP version 13
# Subtest: database repository bundle persists a submission and settlement when Supabase is configured
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
  ---
  duration_ms: 14640.065714
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
  ---
  duration_ms: 15117.827505
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
  ---
  duration_ms: 15724.140596
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
  ---
  duration_ms: 14683.969838
  type: 'test'
  ...
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
  ---
  duration_ms: 642.527924
  type: 'test'
  ...
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
  ---
  duration_ms: 15219.061955
  type: 'test'
  ...
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
  ---
  duration_ms: 26417.051715
  type: 'test'
  ...
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 103128.413516
```

Result: **PASS** — 7/7 tests pass against live Supabase.

### Verdict

**YELLOW** — 1 active blocker (ingestor_health). Meets PM minimum bar of YELLOW.
