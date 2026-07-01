# UTV2-1379 — domainAnalysis Population / Confidence-Delta Fallback (PARTIAL FIX)

## Verification

This file is the T1 verification record for UTV2-1379. **This is a partial fix, not a closure.** See "Scope" below and UTV2-1394 for what remains open.

## Metadata

| Field | Value |
|---|---|
| Issue ID | UTV2-1379 |
| Tier | T1 |
| Owner | claude/utv2-1379 |
| Date | 2026-07-01 |
| Verifier Identity | claude/utv2-1379-domain-analysis-population |
| Commit SHA(s) | `11009e8c4d09f8c8a84e4784e261ed47cb602132` (branch head; merge SHA bound post-merge) |
| Related PRs | (filled on open) |
| Blocking follow-up | UTV2-1394 — no-domainAnalysis write/persistence gap, must land before UTV2-1379 can be considered fully resolved |

## Scope

**Claims (fixed in this lane):**
- `EdgeFallbackReason` widened additively (Tier C, PM-approved): `no-confidence`, `no-market-key`, `no-participant-scope`, `no-provider-offer`, `computation-error`
- `real-edge-service.ts`'s `computeRealEdge()` now classifies only what it can prove, fails closed on any exception (never propagates uncaught into a silent success), and confidence-delta results always report `hasRealEdge: false` (UTV2-985 hardening)
- `domain-analysis-service.ts` records `fallbackReason: 'no-confidence'` when odds are valid but confidence is absent
- `enrichPickAtPromotionTime()` (promotion-service.ts) fixes the UTV2-1327 no-op: now also fires when `domainAnalysis` exists but is confidence-only, attempting bounded market-backed recovery via the same provider-offer path used at submission time. Fails closed — never fabricates edge. Wired into the primary eager evaluation path.
- `apps/smart-form`: conviction=10 no longer maps to confidence=1.0 (was silently skipping domainAnalysis entirely for max-conviction picks); capped at 0.99 with explicit `confidenceSource` provenance. `CLAUDE.md` corrected — smart-form's `capperConviction` has mapped to submission `confidence` since March 2026 (UTV2-255); a new confidence-input UI was correctly identified as redundant and NOT built.
- `scripts/edge-fallback-report/`: new read-only measurement tool + tests

**Does NOT claim (see UTV2-1394):**
- Fixing why ~87-91% of picks have **no** `domainAnalysis` metadata at all (`unknown-legacy` category) — this is a separate, larger write/persistence gap discovered while re-measuring, confirmed active/ongoing (not historical) via 7-day and 14-day production-only windows. `smart-form` and `alert-agent` are ~100% unknown-legacy in every window measured; `board-construction` is a clean 0%.
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
| 11 | conviction=10 maps to confidence=0.99, not 1.0; `confidenceSource` set | test | PASS |
| 12 | Existing golden-regression / promotion-edge-integration suites pass with updated (more specific) fallback reason expectations | test | PASS |
| 13 | pnpm verify green (lint, type-check, build, full test suite, live-DB proof) | repo-truth | PASS |
| 14 | R-level check PASS (lifecycle-fsm, promotion-scoring, operator-ui matched; R4 fault-report advisory/PM-gated per policy, not blocking) | repo-truth | PASS |
| 15 | Live fallback distribution measured at 3 windows (90d/14d/7d), production-only variant added | runtime | PASS — see evidence below |

## Evidence Blocks

### E13 pnpm verify

Full pipeline green: env:check, lint, type-check, build, `pnpm test` (95 test-run blocks, 0 failures across the monorepo), live-DB proof suite (`test:db` + 14 sequential T1 proof live-DB test files, including the UTV2-1327 promotion enrichment live-DB test against real pick schemas).

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

By-source unknown-legacy rate is stable across the 7d/14d windows: `smart-form` 100%/100%, `alert-agent` ~99.8%/~99.9%, `model-driven` ~99.8%/~99.9%, `board-construction` 0%/0%, `system-pick-scanner` 61.7%/47.6%. This rules out historical-data contamination as the explanation — filed as UTV2-1394, a blocking follow-up.

## Stop Conditions Encountered

- Dropped the planned smart-form confidence-input UI sub-task entirely after discovering `capperConviction` already maps to `confidence` (live since March 2026) — building it would have been redundant work on an already-solved problem. Corrected `apps/smart-form/CLAUDE.md`, which had caused the stale premise.
- Stopped before opening this PR as "Closes UTV2-1379" after the re-measurement revealed the larger unknown-legacy gap — filed UTV2-1394 and changed this PR to "Refs" / partial-fix language per PM direction.

## Sign-off

**Verifier:** claude/utv2-1379-domain-analysis-population — 2026-07-01
**PM acceptance:** pending
**Status:** PARTIAL FIX — do not close UTV2-1379 until UTV2-1394 lands

## Merge SHA Binding

(Filled post-merge by post-merge-lane-close.yml)
