# UTV2-1476 Verification

## Summary

| Field | Value |
| --- | --- |
| Issue | UTV2-1476 |
| Tier | T2 |
| Branch | claude/utv2-1476-readiness-ledger-refresh |
| Head SHA | `58f48f4a534a1a63c73f0d1aed73811ad98b0cda` (pre-merge, rebased onto main) |

## Verification

- [x] `pnpm verify` — PASS (lint + type-check + build + full unit test suite, 0 failures)
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS, 2 changed files, no R-level artifacts required
- [x] `readiness-score.json` validated as parseable JSON (`jq empty`)
- [x] `.github/workflows/readiness-refresh.yml` validated as parseable YAML (`python3 -c "import yaml; yaml.safe_load(...)"`)
- [x] Manually exercised the staleness-check bash logic embedded in the new workflow against the refreshed ledger locally — confirms `AGE_HOURS` computation and issue-body composition are correct (0h at refresh time, correctly below the 36h warn threshold)

## Scope

Docs + workflow only — `docs/06_status/readiness/readiness-score.json`, `.github/workflows/readiness-refresh.yml`, `docs/06_status/lanes/UTV2-1476.json`. No runtime, domain, contract, or migration paths touched. `scripts/readiness-report.mjs` intentionally untouched (its evidence-collection logic is explicitly out of scope per the issue text).

## Acceptance Criteria Mapping

- "readiness-score.json is refreshed with current evidence and passes the gate at merge time" — refreshed to `generated_at: 2026-07-06T18:00:00Z` (0h stale at write time), so the staleness sub-check in `readiness-regression-gate.yml` passes. The verdict itself is honestly `RED` (production deploy is stale and the ingestor is externally blocked per UTV2-1477) — this is the correct, non-narrative output for the current system state, not a bypass. `readiness-regression-gate.yml` is not a required branch-protection status check, so an honest RED does not block unrelated merges.
- "a mechanical path exists to keep it refreshed going forward" — `.github/workflows/readiness-refresh.yml`, scheduled every 12h + `workflow_dispatch`, opens a GitHub issue when the ledger exceeds a 36h warn threshold (ahead of the 48h hard gate) and auto-closes it once refreshed. Chosen as the narrowest option per the issue's own guidance, since full auto-regeneration via `readiness-report.mjs`'s live signals is unreliable for the `ingestor_health`/`worker_runtime` dimensions (legacy-table query, out of scope to fix here).
- "no manual bypass of the Readiness Regression Gate threshold" — the 48h threshold in `readiness-regression-gate.yml` is untouched.
- "verification proof shows the gate passing on a live CI run" — see PR CI run for `Readiness Regression Gate` post-refresh (staleness sub-check passes; verdict sub-check reflects the genuine RED state, which is expected and does not block merge since the check is advisory, not required).

## Merge SHA Binding

Head SHA: `58f48f4a534a1a63c73f0d1aed73811ad98b0cda`
Merge SHA: N/A (pre-merge; to be bound post-merge)
