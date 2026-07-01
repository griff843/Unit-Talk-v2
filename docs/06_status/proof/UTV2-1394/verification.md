# UTV2-1394 — domainAnalysis Measurement-Tool Contamination Fix

## Verification

This file is the T1 verification record for UTV2-1394.

## Summary

Re-scoped from a suspected write/persistence gap to a measurement-tool contamination fix, per live-DB investigation. No production code (`apps/api/**`, `packages/contracts/**`) is touched. Full investigation narrative lives in `docs/06_status/proof/UTV2-1379/verification.md` (E16).

## Metadata

| Field | Value |
|---|---|
| Issue ID | UTV2-1394 |
| Tier | T1 |
| Owner | claude/utv2-1394 |
| Date | 2026-07-01 |
| Verifier Identity | claude/utv2-1394-edge-fallback-report-testrun-fix |
| Commit SHA(s) | (filled post-merge by post-merge-lane-close.yml) |
| Related follow-up | UTV2-1396 — test-fixture-pollutes-production-source-metrics hygiene gap (backlog, not blocking) |

## Scope

**Claims:**
- `run-edge-fallback-report.ts`'s `--production-only` mode now excludes `metadata.testRun` rows in addition to the existing source-based `NON_PRODUCTION_SOURCES` exclusion
- Existing source-based exclusion is preserved, not weakened
- `excluded_non_production_source_count` and `excluded_test_fixture_count` added to summary output for transparency
- 7d/14d/90d re-measurement re-run with the corrected filter; UTV2-1379's evidence updated with the corrected denominator and a post-deploy-only live spot check

**Does NOT claim:**
- Any domainAnalysis write/persistence fix (none needed — live investigation found none)
- Any historical row backfill or deletion
- Fixing other source-keyed tools/dashboards potentially exposed to the same testRun contamination (filed separately as UTV2-1396)

## Assertions

| # | Assertion | Evidence Type | Result |
|---|---|---|---|
| 1 | productionOnly excludes metadata.testRun rows regardless of source | test | PASS |
| 2 | non-productionOnly runs still include testRun rows (no silent exclusion outside production-only mode) | test | PASS |
| 3 | Existing non-production-source exclusion behavior unchanged | test | PASS |
| 4 | pnpm verify green (lint, type-check, build, full test suite) | repo-truth | PASS |
| 5 | pnpm test:db green (live Supabase) | runtime | PASS |
| 6 | R-level check PASS — no lifecycle-fsm/promotion-scoring/operator-ui rules matched (tooling-only diff) | repo-truth | PASS |
| 7 | Corrected 7d/14d/90d measurement re-run against live Supabase | runtime | PASS — see evidence below |
| 8 | Post-deploy-only spot check confirms zero write-path gap for real production sources | runtime | PASS — see evidence below |

## Evidence Blocks

### E1 pnpm verify

Full pipeline green: env:check, lint, `pnpm type-check`, build, `pnpm test` (full workspace suite, including the 2 new edge-fallback-report tests).

### E2 pnpm test:db

Command: `pnpm test:db` (live Supabase `zfzdnfwdarxucxtaojxm`)
```
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 100819.012003
```

### E3 R-level check

`scripts/ci/r-level-check.ts --base origin/main --head HEAD`:
```
Verdict: PASS
Changed files: 2
Rules matched: (none) — no R-level artifacts required for this diff
```
Consistent with a measurement-tool-only change touching no lifecycle-fsm/promotion-scoring/operator-ui paths.

### E4 Corrected fallback measurement (live Supabase, testRun excluded)

Snapshots in `docs/06_status/proof/UTV2-1379/corrected-2026-07-01/`.

| Window | Total analyzed | Excluded (source) | Excluded (testRun) | domain-analysis | unknown-legacy |
|---|---|---|---|---|---|
| 90d (unfiltered) | 56,224 | 0 | n/a | 5.79% | 87.17% |
| 14d (production-only) | 5,232 | 4,053 | 8,589 | 36.51% | 62.35% |
| 7d (production-only) | 3,140 | 3,139 | 6,092 | 24.2% | 73.89% |

Remaining unknown-legacy in the 7d/14d windows is pre-fix historical data — the UTV2-1379 fix (which set `fallbackReason: 'no-confidence'` for no-confidence picks) merged at `2026-07-01T18:16:00.000Z`, so almost the entire 7d/14d window predates it. Full explanation in UTV2-1379's verification.md E16.

### E5 Post-deploy-only spot check

Live SQL sample (picks created strictly after `2026-07-01T18:16:00.000Z`, testRun/non-production sources excluded):

| Source | Total | unknown-legacy |
|---|---|---|
| system-pick-scanner | 18 | 0 |
| alert-agent | 8 | 0 |
| model-driven | 7 | 0 |
| smart-form | 2 | 0 |

Zero unknown-legacy across every real production source once the UTV2-1379 fix is actually live. Confirms no active write/persistence gap.

## Stop Conditions Encountered

- Did not implement a domainAnalysis write/persistence fix after live-DB investigation showed none was needed — corrected course from the original UTV2-1394 scope per PM direction, re-scoped the issue in Linear before writing any code.

## Sign-off

**Verifier:** claude/utv2-1394-edge-fallback-report-testrun-fix — 2026-07-01
**PM acceptance:** pending
**Status:** measurement-tool fix complete; UTV2-1379 unblocked

## Merge SHA Binding

(Filled post-merge by post-merge-lane-close.yml)
