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

### Verdict

**YELLOW** — 1 active blocker (ingestor_health). Meets PM minimum bar of YELLOW.
