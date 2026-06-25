# Verification — UTV2-1309 G-CONST-14 Readiness Score Ledger

**Lane:** UTV2-1309
**Tier:** T1
**Branch:** claude/utv2-1309-g-const-14-readiness-score-ledger
**Verified at:** 2026-06-25T08:10:00Z
**Worktree:** /home/griff843/code/Unit-Talk-v2/.out/worktrees/claude__utv2-1309-g-const-14-readiness-score-ledger

## Verification

### pnpm type-check

```
> @unit-talk/v2@0.1.0 type-check
> pnpm exec tsc -b tsconfig.json

Exit code: 0 (PASS)
```

### pnpm test

```
# tests 19
# suites 0
# pass 19
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1158.00568

Exit code: 0 (PASS)
```

### pnpm test:db

TAP output (required for Proof Auditor Gate):

```
# Subtest: UTV2-920: atomic delivery confirmation write — happy path (all writes committed)
ok 1 - UTV2-920: atomic delivery confirmation write — happy path (all writes committed)
  ---
  duration_ms: ...
  type: 'test'
  ...
# Subtest: UTV2-920: duplicate delivery attempt — idempotent (no duplicate outbox or receipt rows)
ok 2 - UTV2-920: duplicate delivery attempt — idempotent (no duplicate outbox or receipt rows)
  ---
  duration_ms: ...
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
  ---
  duration_ms: 18791.394524
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
  ---
  duration_ms: 29008.982471
  type: 'test'
  ...
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
  ---
  duration_ms: 3605.405721
  type: 'test'
  ...
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
  ---
  duration_ms: 17531.738311
  type: 'test'
  ...
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
  ---
  duration_ms: 15741.695889
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
# duration_ms 121629.055141

Exit code: 0 (PASS)
```

### R-level check

```
tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD

Verdict: PASS
Changed files: 2
Rules matched: (none) — no R-level artifacts required for this diff
```

## Runtime data collected (read-only, no mutations)

| Dimension | Query / Source | Result |
|---|---|---|
| deploy_sha_alignment | gh run list --workflow deploy.yml | headSha=70783c07 vs main 8cfebde5 — MISMATCH |
| ingestor_health | system_runs WHERE run_type='ingestor.cycle' AND status='succeeded' | last_run=2026-06-24T14:49:45Z (~17h ago) |
| worker_outbox_health | distribution_outbox WHERE status='pending' AND created_at<NOW()-30min | stuck_count=552 |
| dead_letter_count | distribution_outbox WHERE status='dead_letter' | dl_count=946 |
| db_tripwires | docs/06_status/CURRENT_STATE.md | G-CONST-12 OPEN, G-CONST-13 OPEN, outbox elevated |
| pnpm_verify | gh run list --branch main | CI in_progress at audit time; Post-Merge QA Gate success |
| proof_coverage | docs/06_status/proof/UTV2-{1285,1286,1288,1301}/ | Merge SHA present in all sampled proofs |
| constitution_convergence | executive-summary.md | ~68% (safety ~85% / intelligence ~35%) |

## Verdict

**RED** — 5 blocking failures (deploy_sha_alignment, ingestor_health, worker_outbox_health, dead_letter_count, db_tripwires). This is consistent with CURRENT_STATE.md blocker register and the G-CONST-13 open gap. Mechanical verdict per schema: >2 blocking failures = RED.

## Merge SHA

<!-- post-merge-lane-close.yml will append the merge SHA here -->
Merge SHA: 388ef5f58c985f9da0f1c9cf9ef3305bb7a206a2

## pnpm verify

Full pipeline (env:check + lint + type-check + build + test):

```
pnpm verify
Exit code: 0 (PASS) — see CI on PR #1070
```
