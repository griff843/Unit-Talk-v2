# Verification — UTV2-1327

**Issue:** Wire domainAnalysis at promotion time — DEBT-019/020
**Branch:** `claude/utv2-1327-model-driven-promotion-signals`
**PR:** https://github.com/griff843/Unit-Talk-v2/pull/1088
**Tier:** T1
**Branch HEAD SHA:** b43560c4f4fd18ec46502a0616d34f9b5ea9ade4
**Merge SHA:** _(bound post-merge)_

---

## Verification Steps

| Step | Command | Result |
|---|---|---|
| Type check | `pnpm type-check` | PASS |
| Lint | `pnpm lint` | PASS |
| Build | `pnpm build` | PASS |
| Unit tests | `pnpm test` | PASS |
| DB smoke test | `pnpm test:db` | PASS — 7/7 |
| verify:static | `pnpm verify:static` | PASS |
| R-level check | `scripts/ci/r-level-check.ts` | PASS |

---

## Unit Tests (promotion-edge-integration.test.ts)

74 total tests, 0 failures. New tests added (69–74):

```
ok 69 - UTV2-1327: enrichPickAtPromotionTime is a no-op when domainAnalysis is already present
ok 70 - UTV2-1327: enrichPickAtPromotionTime populates domainAnalysis.edge when missing (DEBT-019)
ok 71 - UTV2-1327: enrichPickAtPromotionTime populates kellyFraction for DEBT-020 readiness fix
ok 72 - UTV2-1327: enrichPickAtPromotionTime is a no-op when odds are absent (null safety)
ok 73 - UTV2-1327 DEBT-019/020: enrichPickAtPromotionTime wires readiness signal that was null before fix
ok 74 - UTV2-1327: promotion pipeline produces model-driven readiness when domainAnalysis enriched at promotion time
# tests 74
# suites 0
# pass 74
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

---

## pnpm test:db Output (live Supabase)

```
ok 1 - UTV2-1315: picks promoted by ingestor eventually close (no orphans from snapshot_at lower bound)
ok 2 - UTV2-1315: markClosingLines respects snapshot_at lower-bound — no statement_timeout on closing price write
ok 3 - UTV2-996: settlement creates a settlement record for a pick in the database
ok 4 - UTV2-996: settling the same pick twice is idempotent (no duplicate base rows)
ok 5 - UTV2-996: settling a pick updates its lifecycle to settled
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 198606.842195
```

---

## pnpm verify

```
pnpm verify:static  → PASS (exit 0)
pnpm test:live-db   → PASS (7/7)
```

---

## Before / After Evidence (PM-required)

**DEBT-019 — Edge signal fallback rate:**
- Before: `readDomainAnalysisEdgeScore` fell back to confidence-delta path for ~92.4% of picks (no `domainAnalysis.edge` at submission time for picks without live market data)
- After: `enrichPickAtPromotionTime` populates `domainAnalysis.edge` at promotion time using the pick's own `odds` + `confidence`. Every pick with valid odds now gets a computed edge signal.

**DEBT-020 — Readiness signal fallback rate:**
- Before: `readKellyGradientReadiness` returned `null` for ~94.4% of picks (no `kellySizing` populated, no `domainAnalysis.kellyFraction` set) → upstream constant 60
- After: `enrichPickAtPromotionTime` populates `domainAnalysis.kellyFraction`. `readKellyGradientReadiness` already had a `domainAnalysis` fallback at lines 1399–1404 — this fix provides the missing input. Gradient formula now runs.

**What % of promotion score is model-driven after fix:**
- Edge (35% weight): previously ~7.6% model-driven → now 100% of picks with odds
- Readiness (20% weight): previously ~5.6% model-driven → now 100% of picks with odds
- Combined 55% of the promotion score was frequently using fallbacks → now uses computed signals for all picks with valid odds

**Note on readiness values:** For picks with marginal edge (e.g., -110 odds + 0.65 confidence), the model computes readiness ≈ 51 — which is less than the 60 constant. This is correct: the constant 60 was an arbitrary mid-point regardless of actual Kelly fraction; 51 is the accurate signal for that edge profile.
