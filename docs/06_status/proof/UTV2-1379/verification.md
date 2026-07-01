# UTV2-1379 — domainAnalysis Population / Confidence-Delta Fallback (PARTIAL FIX)

## Verification

This file is the T1 verification record for UTV2-1379.

**Update 2026-07-01 (UTV2-1394):** the "does NOT claim" write/persistence gap described below has been resolved — it was measurement contamination, not a real gap. See "Corrected measurement" below. UTV2-1379 is unblocked as of the UTV2-1394 fix landing.

## Metadata

| Field | Value |
|---|---|
| Issue ID | UTV2-1379 |
| Tier | T1 |
| Owner | claude/utv2-1379 |
| Date | 2026-07-01 |
| Verifier Identity | claude/utv2-1379-domain-analysis-population |
| Commit SHA(s) | `f2de2430f9d6ea9ae6bbabc1d306df9f0894708d` (merge SHA) |
| Related PRs | https://github.com/griff843/Unit-Talk-v2/pull/1136 |
| Blocking follow-up | UTV2-1394 — no-domainAnalysis write/persistence gap, must land before UTV2-1379 can be considered fully resolved |

## Scope

**Claims (fixed in this lane):**
- `EdgeFallbackReason` widened additively (Tier C, PM-approved): `no-confidence`, `no-market-key`, `no-participant-scope`, `no-provider-offer`, `computation-error`
- `real-edge-service.ts`'s `computeRealEdge()` now classifies only what it can prove, fails closed on any exception (never propagates uncaught into a silent success), and confidence-delta results always report `hasRealEdge: false` (UTV2-985 hardening)
- `domain-analysis-service.ts` records `fallbackReason: 'no-confidence'` when odds are valid but confidence is absent
- `enrichPickAtPromotionTime()` (promotion-service.ts) fixes the UTV2-1327 no-op: now also fires when `domainAnalysis` exists but is confidence-only, attempting bounded market-backed recovery via the same provider-offer path used at submission time. Fails closed — never fabricates edge. Wired into the primary eager evaluation path.
- `scripts/edge-fallback-report/`: new read-only measurement tool + tests

**Moved to a separate PR (lane-authority boundary — `apps/smart-form/**` is not in the `runtime` lane's allowed paths):**
- The conviction=10→confidence=1.0 fix and the `apps/smart-form/CLAUDE.md` correction. Investigation (smart-form's `capperConviction` mapping to `confidence` since March 2026, ruling out the originally-planned confidence-input UI as redundant) still holds and informed this lane's fixes — only the code change itself moved to a `delivery-ui` lane PR.

**Originally believed out of scope, since resolved (see UTV2-1394 / E16 below):**
- The apparent 87-91% "no domainAnalysis at all" gap turned out to be measurement contamination (test fixtures under real source labels), not a write/persistence bug. See E16 for the corrected measurement and post-deploy-only spot check showing 0% unknown-legacy for real production sources once this fix is live.

**Does NOT claim:**
- Any DB backfill of historically-affected picks
- Any change to Kelly sizing or exposure-band logic (out of scope per Outcome Contract)

## Assertions

| # | Assertion | Evidence Type | Result |
|---|---|---|---|
| 1 | `EdgeFallbackReason` widened additively; existing values unchanged | repo-truth | PASS |
| 2 | Empty marketKey → `no-market-key`, no tier attempted | test | PASS |
| 3 | Empty moneyline selection → `no-participant-scope` | test | PASS |
| 4 | No offer found in any tier → `no-provider-offer` | test | PASS |
| 5 | Thrown exception → `computation-error`, fails closed (no silent success) | test | PASS |
| 6 | confidence-delta never reports `hasRealEdge: true` | test | PASS |
| 7 | Odds valid, confidence absent → `no-confidence` on domainAnalysis | test | PASS |
| 8 | `enrichPickAtPromotionTime` recovers real edge when provider context now exists | test | PASS |
| 9 | `enrichPickAtPromotionTime` fails closed + refreshes fallbackReason when still no data | test | PASS |
| 10 | Recovery does not run without `providerOffers` supplied (bounded, opt-in) | test | PASS |
| 11 | (moved — conviction=10 fix now lives in a separate delivery-ui-lane PR) | n/a | n/a |
| 12 | Existing golden-regression / promotion-edge-integration suites pass with updated (more specific) fallback reason expectations | test | PASS |
| 13 | pnpm verify green (lint, type-check, build, full test suite, live-DB proof) | repo-truth | PASS |
| 14 | R-level check PASS (lifecycle-fsm, promotion-scoring, operator-ui matched; R4 fault-report advisory/PM-gated per policy, not blocking) | repo-truth | PASS |
| 15 | Live fallback distribution measured at 3 windows (90d/14d/7d), production-only variant added | runtime | PASS — see evidence below |

## Evidence Blocks

### E13 pnpm verify

Full pipeline green: env:check, lint, type-check, build, `pnpm test` (111 tests, 0 failures across the affected suites after moving the smart-form fix out of this lane), live-DB proof suite (`pnpm test:db` + 14 sequential T1 proof live-DB test files, including the UTV2-1327 promotion enrichment live-DB test against real pick schemas).

**`pnpm test:db` output (live Supabase `zfzdnfwdarxucxtaojxm`):**
```
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 105238.632566
```

### E14 R-level check

```
Verdict: PASS
Changed files: 18
Rules matched: lifecycle-fsm, promotion-scoring, operator-ui

Advisory (PM-gated) artifacts missing:
  - r4-fault-report [PM-gated]
```
R4 is advisory for `promotion-scoring` and PM-gated (not a hard CI block) for `lifecycle-fsm` per `docs/05_operations/r1-r5-rules.json` — the tool's own PASS verdict reflects this; not treated as a gap.

### E15 Live fallback distribution (PRE-DEPLOY — none of this fix is live in production yet)

Three snapshots attached: `edge-fallback-summary-{90d-PRE-DEPLOY-unfiltered,14d-PRE-DEPLOY-production-only,7d-PRE-DEPLOY-production-only}.json` (+ matching `-by-source` CSVs).

| Window | Total analyzed | domain-analysis | unknown-legacy |
|---|---|---|---|
| 90d (unfiltered) | 55,858 | 5.82% | 87.3% |
| 14d (production-only) | 13,795 | 14.92% | 85.05% |
| 7d (production-only) | 8,993 | 8.57% | 91.37% |

By-source unknown-legacy rate is stable across the 7d/14d windows: `smart-form` 100%/100%, `alert-agent` ~99.8%/~99.9%, `model-driven` ~99.8%/~99.9%, `board-construction` 0%/0%, `system-pick-scanner` 61.7%/47.6%. **This measurement was later found to be contaminated — see below.**

### E16 Corrected live fallback distribution (UTV2-1394, 2026-07-01)

Live-DB investigation (not static code review) for UTV2-1394 found that `pnpm test:db` / T1 proof suites write real fixture rows into production `picks`, tagged `metadata.testRun`, under real production `source` values (mostly `smart-form`). `run-edge-fallback-report.ts`'s `--production-only` filter only excluded by `source` string, so every testRun row above was counted as an unenriched real pick. UTV2-1394 fixed the filter to also exclude `metadata.testRun` rows.

Corrected snapshots: `edge-fallback-summary-{90d-unfiltered-corrected,14d-production-only-corrected,7d-production-only-corrected}.json` (+ matching `-by-source` CSVs), in this same directory.

| Window | Total analyzed | Excluded (source) | Excluded (testRun) | domain-analysis | unknown-legacy |
|---|---|---|---|---|---|
| 90d (unfiltered) | 56,224 | 0 | 0 (n/a in unfiltered mode) | 5.79% | 87.17% |
| 14d (production-only, corrected) | 5,232 | 4,053 | 8,589 | 36.51% | 62.35% |
| 7d (production-only, corrected) | 3,140 | 3,139 | 6,092 | 24.2% | 73.89% |

The corrected numbers are better but still show substantial unknown-legacy in the 7d/14d windows. Root cause of the *remainder*: the UTV2-1379 fix (this PR) merged at `2026-07-01T18:16:00.000Z` — almost the entire 7d/14d window predates it, and pre-fix `computeSubmissionDomainAnalysis()` did not set `fallbackReason: 'no-confidence'` for no-confidence picks, so those legacy rows correctly fall through to `unknown-legacy` under the classifier (it can only classify what the stored metadata proves).

**Post-deploy-only spot check** (live SQL, picks created strictly after `2026-07-01T18:16:00.000Z`, testRun and non-production sources excluded): `system-pick-scanner` 0/18 unknown-legacy, `alert-agent` 0/8, `model-driven` 0/7, `smart-form` 0/2. **Zero unknown-legacy across every real production source once the fix is actually live.**

**Conclusion:** there is no active domainAnalysis write/persistence bug. UTV2-1394 is re-scoped to the measurement-tool fix (done) plus a follow-up hygiene issue (UTV2-1396, test fixtures polluting production source metrics generally). UTV2-1379 is unblocked.

## Stop Conditions Encountered

- Dropped the planned smart-form confidence-input UI sub-task entirely after discovering `capperConviction` already maps to `confidence` (live since March 2026) — building it would have been redundant work on an already-solved problem. Corrected `apps/smart-form/CLAUDE.md`, which had caused the stale premise.
- Stopped before opening this PR as "Closes UTV2-1379" after the re-measurement revealed the larger unknown-legacy gap — filed UTV2-1394 and changed this PR to "Refs" / partial-fix language per PM direction.

## Sign-off

**Verifier:** claude/utv2-1379-domain-analysis-population — 2026-07-01
**PM acceptance:** pending
**Status:** UNBLOCKED 2026-07-01 — UTV2-1394's corrected measurement (E16) confirms no active write/persistence gap remains

## Merge SHA Binding

(Filled post-merge by post-merge-lane-close.yml)
