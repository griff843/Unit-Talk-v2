# Verification: UTV2-1032 — DEVELOPING label proof run

**Tier:** T2
**Executor:** codex-cli
**Branch:** codex/utv2-1032-developing-label-proof-run-trigger-after-50-real-edge-backed
**Merge SHA:** db497b886e1772259555d755ca2018708647ce1b
**Date:** 2026-05-28

## Summary

Adds `--real-edge-only` flag to `scripts/roi-by-sport.ts` to filter ROI metrics to
market-backed edge picks only. Implements `resolveEdgeSourceSplit()` to classify each
settled pick as `real-edge-backed`, `confidence-proxy`, or `unknown` using promotion
history payloads from `pick_promotion_history` table.

Clarifies `MODEL_EDGE_ACCEPTANCE_STANDARD.md`: DEVELOPING requires ≥50 real-edge-backed
settled bets, explicitly excluding confidence-proxy rows.

## Verification

### Static Verification (pnpm verify)

```
pnpm verify — PASS
  pnpm type-check: PASS
  pnpm test: 619 pass, 0 fail
  lint: PASS
  build: PASS
```

### Issue-Specific: roi-by-sport.ts --real-edge-only

```
pnpm exec tsx scripts/roi-by-sport.ts --real-edge-only --after=2026-05-10 --monitor-json
  tier: UNPROVEN
  settledRows: 0
  roiPercent: null
  clvCoveragePercent: null
  → DATA_GATED: 0 real-edge-backed settled picks post-fix

pnpm exec tsx scripts/roi-by-sport.ts --real-edge-only --after=1970-01-01 --monitor-json
  tier: UNPROVEN
  settledRows: 5
  roiPercent: null
  clvCoveragePercent: 0
  → DATA_GATED: 5 real-edge-backed settled picks all-time (50 required for DEVELOPING)
```

### R-Level Compliance

```
Verdict: PASS
Changed files: 13
Rules matched: (none) — no R-level artifacts required for this diff
```

### Acceptance Criteria Status

- `roi-by-sport.ts --real-edge-only` reports ≥50 settled picks: **FAIL** — 0 post-fix, 5 all-time
- ROI point estimate positive: **FAIL** — no measurable stake-backed real-edge sample
- CLV coverage ≥60%: **FAIL** — 0% all-time, N/A post-fix
- Evidence bundle generated: **PASS** — `docs/06_status/proof/UTV2-1032/evidence.json`
- `MODEL_EDGE_ACCEPTANCE_STANDARD.md` tier label updated: **NOT DONE** — data gate not met

## Closeout Decision

Proof result: **DATA_GATED**. The `--real-edge-only` implementation is complete and correct.
Only 5 real-edge-backed settled picks exist (50 required). DEVELOPING label not asserted.
This lane delivers the tooling and clarifies the standard; the milestone trigger fires when
the pick count crosses 50.

Evidence: `docs/06_status/proof/UTV2-1032/evidence.json` (verdict: DATA_GATED)
