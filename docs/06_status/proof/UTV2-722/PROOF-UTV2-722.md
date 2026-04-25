# PROOF-UTV2-722 — SGO Historical CLV Coverage

**Issue:** UTV2-722 — Measure SGO historical CLV coverage by sport, market, and book  
**Date:** 2026-04-25  
**Method:** Direct SQL queries against live Supabase (`provider_offers`, `sgo_replay_coverage`)  
**Window:** 2026-04-01 → 2026-04-24  
**Note:** `scripts/sgo-historical-coverage.ts` could not run due to `esbuild spawn EPERM` in the Codex sandbox. Equivalent coverage metrics were gathered via direct DB queries instead.

---

## 1. Provider Offers Coverage

| Sport | Events | Opening w/odds | Closing w/odds |
|-------|--------|---------------|----------------|
| MLB | 95 | 478,377 | 283,434 |
| NBA | 26 | 462,045 | 217,061 |
| NHL | 22 | 197,943 | 92,831 |

All three sports have substantial opening and closing offer volume.

## 2. CLV-Ready Pairs (open + close matched per event/market/participant/book)

| Sport | Events with both | CLV-ready pairs |
|-------|-----------------|-----------------|
| NBA | 12 | 4,588,873 |
| MLB | 47 | 2,740,025 |
| NHL | 12 | 1,584,158 |

CLV-ready pair = provider_offers with both opening and closing snapshot for the same `(provider_event_id, provider_market_key, provider_participant_id, bookmaker_key)` tuple.

## 3. Scored Candidate Replay Eligibility

Via `sgo_replay_coverage` view (created by UTV2-727):

| Sport | Scored Candidates | Has Opening | Has Closing | Replay-Eligible | % |
|-------|-------------------|-------------|-------------|-----------------|---|
| MLB | 492 | 491 | 394 | 393 | **79.9%** |
| NBA | 168 | 168 | 100 | 100 | **59.5%** |
| NHL | 0 | — | — | — | — (no scored candidates) |

**Total replay-eligible: 493 candidates** (393 MLB + 100 NBA).

### NHL note

NHL has strong provider_offers coverage (92,831 closing rows, 12 events with CLV-ready pairs) but 0 scored candidates in `sgo_replay_coverage`. This is a model coverage gap — champion model does not score NHL props — not a provider data gap. NHL designated **live-only burn-in**.

## 4. Slice Assessment

| Sport | Verdict | Rationale |
|-------|---------|-----------|
| MLB | **REPLAY-ELIGIBLE** | 393 candidates, 79.9% coverage — sufficient for CLV direction, calibration, ROI, score-band monotonicity |
| NBA | **REPLAY-ELIGIBLE** | 100 candidates, 59.5% coverage — sufficient for CLV direction and calibration |
| NHL | **LIVE-ONLY BURN-IN** | Model coverage gap; provider data present but no scored candidates to replay |

## 5. Comparison with Live Proof Gates

| Gate | Threshold | State |
|------|-----------|-------|
| UTV2-433 MLB `clvBackedOutcomeCount` | ≥ 10 | 3/10 — organic accumulation in progress (134 picks pending) |
| `openCloseRowCount` MLB | ≥ 5 | ✅ MET (283,434 closing rows) |

Historical volume is sufficient for R5 replay. Live gate thresholds (settled picks through live CLV pipeline) accumulate organically.

## 6. Verdict

**PASS — replay chain unblocked.**

UTV2-723 (R5 model-trust replay) may proceed for MLB and NBA slices. NHL deferred pending model coverage. This proof confirms data volume is sufficient for replay to produce meaningful CLV/ROI/calibration evidence. It does not declare models trusted.
