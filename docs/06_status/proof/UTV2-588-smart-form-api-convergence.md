# PROOF: UTV2-588
MERGE_SHA: b8481381994cebee9ed67be30aaa31324b1cb319

ASSERTIONS:
- [x] Smart Form and API submissions produce identical normalized market key for equivalent input
- [x] Both sources produce identical promotionScore (65.71) for identical 5-factor inputs
- [x] Both sources resolve metadata.eventId and metadata.participantId via identical code path (both null when no event provided)
- [x] metadata.promotionScores, domainAnalysis, realEdge all converge identically between sources
- [x] promotionStatus divergence is intentional design: smart-form uses forcePromote (human capper always routes to best-bets); documented in promotion-service.ts:buildSmartFormQualifiedResult
- [x] Smart Form picks are always auto-grade-compatible (forcePromote guarantees qualified status)
- [x] No lossy market identity path: both picks write identical market key "NBA player points"
- [x] source and submittedBy differ intentionally (not canonical truth drift)

EVIDENCE:
```text
=== UTV2-588: Smart Form vs API Convergence Proof ===
Supabase: https://zfzdnfwdarxucxtaojxm.supabase.co
Proof run: utv2-588-1776835544149

STEP 1 · Submit via source: api
pickId: 38526b7f-7c4a-423d-b251-b8a43ce88b10, promotionScore: 65.71, promotionStatus: not_eligible
PASS api-submission

STEP 2 · Submit via source: smart-form
pickId: 4e720d11-7505-4cc1-9df8-db39c91f98c8, promotionScore: 65.71, promotionStatus: qualified
PASS sf-submission

STEP 3 · Canonical field convergence
  [converged] market: "NBA player points"
  [converged] selection: "LeBron James Over 24.5 [utv2-588-1776835544149]"
  [converged] odds: -110
  [converged] confidence: 0.72
  [converged] promotionScore: 65.71
  [intentional-diff] promotionStatus: api="not_eligible" sf="qualified"
  [converged] lifecycleState: "validated"
  [intentional-diff] source: api="api" sf="smart-form"
PASS canonical-convergence

STEP 4 · Metadata identity fields (DB row)
  [converged] metadata.eventId: null
  [converged] metadata.participantId: null
  [converged] metadata.promotionScores: {"edge":78,"trust":82,"boardFit":75,"readiness":80,"uniqueness":60}
  [converged] metadata.domainAnalysis.edge: 0.19619 (both sources)
  [converged] metadata.realEdge: 0.19619 (both sources)
PASS metadata-identity

STEP 5 · Promotion score convergence
  [intentional-diff] promotionStatus: api=not_eligible sf=qualified (forcePromote by design)
PASS promotion-convergence: { apiScore: 65.71, sfScore: 65.71, note: "score converges; status intentionally differs via forcePromote" }

STEP 6 · No lossy market identity
PASS no-lossy-market: { market: "NBA player points" }

STEP 7 · Auto-grade compatibility
  Smart Form pick: qualified=true (forcePromote guarantees this)
  API pick: qualified=false (score-gated, may suppress at lower scores)
PASS auto-grade-compat: { sfQualified: true, note: "smart-form forcePromote guarantees grade compatibility regardless of score" }

FINAL VERDICT
{
  "verdict": "PROVEN",
  "notes": "Smart Form and API submissions converge to identical canonical truth for equivalent picks",
  "apiPickId": "38526b7f-7c4a-423d-b251-b8a43ce88b10",
  "sfPickId": "4e720d11-7505-4cc1-9df8-db39c91f98c8",
  "convergenceFields": ["market","selection","odds","confidence","promotionScore","lifecycleState","metadata.eventId","metadata.participantId"],
  "intentionalDivergenceFields": ["source","submittedBy","promotionStatus (forcePromote)"],
  "noLossyMarketPath": true,
  "autoGradeCompatible": true,
  "proofRunAt": "2026-04-22T05:25:50.613Z"
}
```

Proof run at: 2026-04-22T05:25:50.613Z  
API pick: 38526b7f-7c4a-423d-b251-b8a43ce88b10  
Smart Form pick: 4e720d11-7505-4cc1-9df8-db39c91f98c8
