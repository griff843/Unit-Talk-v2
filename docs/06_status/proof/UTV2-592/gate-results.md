# UTV2-592 Syndicate Proof Gate Results

**Verdict: FAIL — Syndicate readiness thresholds NOT met**
**Date:** 2026-04-25
**Branch:** claude/utv2-592-syndicate-proof-gate
**Script:** `apps/api/src/scripts/utv2-592-syndicate-proof-gate.ts`
**Standard:** `docs/05_operations/SCORE_PROVENANCE_STANDARD.md`

---

## Gate Checklist

| Check | Threshold | Measured | Result |
|---|---|---|---|
| Sample sufficient | ≥ 20 scored rows | 1,000 rows | PASS ✅ |
| Market-backed share | ≥ 60% | 0% | FAIL ⛔ |
| High-trust share (real/consensus-edge) | ≥ 40% | 0% | FAIL ⛔ |
| Unknown share | ≤ 20% | 0% | PASS ✅ |

**VERDICT: FAIL** — 2 of 4 threshold checks failed.

---

## Edge Source Distribution (30-day, n=1,000)

| Edge Source | Count | % | Trust Level | beats CLV | mean clvRaw |
|---|---|---|---|---|---|
| `confidence-delta` | 979 | 97.9% | Low | 88% | +0.0278 |
| `explicit` | 21 | 2.1% | Medium | — | — |
| `real-edge` | 0 | 0% | **High** | — | — |
| `consensus-edge` | 0 | 0% | **High** | — | — |
| `sgo-edge` | 0 | 0% | Medium | — | — |
| `single-book-edge` | 0 | 0% | Medium | — | — |
| `unknown` | 0 | 0% | None | — | — |

---

## Interpretation

The 30-day sample of 1,000 promotion history rows shows:

- **No market-backed scoring.** Zero picks have edge derived from any external market data source (Pinnacle, consensus, SGO, or single-book). Every scored pick uses `confidence-delta` — self-reported confidence minus implied probability from submitted odds.

- **Instrumentation is working.** Unlike the UTV2-580 baseline (97.4% `unknown`), the 30-day current sample shows 0% `unknown` — picks are now being attributed to `confidence-delta` rather than falling through to unknown. This is the UTV2-580 fix working correctly.

- **Calibration signal is positive but not sufficient.** 88% of `confidence-delta` picks beat the closing line in settled samples. This is promising for directional quality but does NOT satisfy the syndicate threshold, which requires market provenance independent of self-reported confidence.

- **Root cause unchanged since UTV2-580.** Real-edge computation requires: (1) Pinnacle devigged result from provider_offers, (2) matching market key, (3) valid participant ID. Most picks still fail at step 2 (market key normalization) or step 3 (participant linkage). Tracked in UTV2-722, UTV2-750 (partial fix).

---

## Path to PASS

For the syndicate gate to pass:
1. **Market key normalization** must be complete (so domain analysis can match provider_offers to picks)
2. **Real-edge computation** must trigger on a majority of picks at submission time
3. UTV2-750 (MLB alias fix) partially addresses #1 for MLB props — 4 markets fixed

Full path tracked in SCORE_PROVENANCE_STANDARD.md §6.

---

## Non-Blocking Note

This FAIL is **expected and by design**. The gate exists to prevent operators from trusting scores without market provenance. The honest answer is: the system cannot claim market-backed scoring for the current live volume. Syndicate readiness requires fixing the real-edge pipeline before this gate can clear.

This gate result explicitly satisfies the UTV2-592 acceptance criterion: *"operators are not asked to trust a score that has not met the proof bar."*
