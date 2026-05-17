---
schema: runtime-verification-v1
issue: UTV2-985
tier: T1
branch: claude/utv2-985-fix-domain-analysis-real-edge-wiring
sha: e5d055952ddb896fc9929701972c283fb8e40426
---

## Runtime Verification

Branch HEAD: `e5d055952ddb896fc9929701972c283fb8e40426`

### Pre-merge Checklist

- [x] `pnpm verify` green (54/54 integration tests, 72/72 submission-service tests, 5/5 golden regression)
- [x] `pnpm test:db` 5/5 against live Supabase (`zfzdnfwdarxucxtaojxm`)
- [x] R-level check: PASS — rules `lifecycle-fsm`, `promotion-scoring`
- [x] `t1-proof-utv2-985-edge-provenance.test.ts` included in PR diff

### Behavioral Change Verified

**Before (confidence-delta masquerade):** `readDomainAnalysisEdgeScore()` returned a
non-zero score (e.g. 100 for confidence=0.65, odds=+150) for 92.4% of picks, causing
those picks to qualify for `exclusive-insights`.

**After (fail-closed):** `readMarketBackedEdgeScore()` returns `null` for any pick where
`realEdgeSource === 'confidence-delta'` or no market provider data is present. Callers
use `marketBackedEdgeScore ?? 0`, so confidence-delta picks receive `edge = 0` in promotion
scoring. Only picks with real market-backed edge (Pinnacle/consensus/SGO/single-book)
or an explicit operator `promotionScores.edge` override qualify.

### Live DB Proof

`pnpm test:db` output (5/5 pass):

```
✔ database repository bundle persists a submission and settlement when Supabase is configured (40224ms)
✔ UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row (39075ms)
✔ UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes (43187ms)
✔ UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row (42521ms)
✔ UTV2-883: no duplicate participants for the same external_id and sport (594ms)
ℹ pass 5
ℹ fail 0
```

### Edge Coverage Baseline (12,043-pick audit)

| Source | Count | % |
|--------|-------|---|
| Real (market-devigged) | ~24 | 0.2% |
| Confidence-delta (proxy) | ~11,128 | 92.4% |
| Other/unknown | ~891 | 7.4% |

Post-fix: all new picks submitted under the fixed scoring engine will have
`edgeProvenance` populated. Confidence-delta picks will receive `edge = 0` in promotion.
