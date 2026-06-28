# UTV2-1342 Model Input Provenance Monitor Spec

Generated at: 2026-06-27T21:42:30-04:00  
Issue: UTV2-1342  
Tier: T2  
Lane type: verification/docs  
Scope: Measurement-only monitor definition

## Purpose

UTV2-1342 defines the monitor that should report two post-UTV2-1327 promotion-input health measures for new picks:

- fallback rate: the share of new promotion decisions whose edge input used confidence fallback instead of market-backed or explicit evidence
- model-driven promotion-score percentage: the weighted share of each promotion score that came from computed model/runtime inputs instead of neutral or operator-provided fallbacks

This spec is read-only. It does not require a migration, runtime write path, or change to promotion eligibility.

## Existing Data Source

The monitor should read `pick_promotion_history.payload`, which stores `PromotionDecisionSnapshot` records at promotion decision time.

Authoritative fields already persisted in the snapshot:

| Field | Meaning |
|---|---|
| `payload->'scoreInputs'->>'edgeSourceQuality'` | `market-backed`, `confidence-fallback`, or `explicit` edge-source bucket |
| `payload->'scoreInputs'->>'edgeMethod'` | `market-devigged` or `confidence-delta` |
| `payload->'scoreInputs'->>'providerCoverageState'` | provider tier, or `none` when no market data backed the edge |
| `payload->'scoreInputs'->>'edgeFallbackReason'` | stable reason label when confidence fallback fires |
| `payload->'scoreInputs'->>'uniquenessFallbackReason'` | stable reason label when uniqueness uses fallback |
| `payload->'scoreInputs'->'uniquenessInputs'` | present when uniqueness was computed from open-pick context |
| `payload->'scoreInputs'->>'edge'` | raw 0-100 edge component after fail-closed logic |
| `payload->'scoreInputs'->>'trust'` | raw 0-100 trust component |
| `payload->'scoreInputs'->>'readiness'` | raw 0-100 readiness component |
| `payload->'scoreInputs'->>'uniqueness'` | raw 0-100 uniqueness component |
| `payload->'scoreInputs'->>'boardFit'` | raw 0-100 board-fit component |

Relevant source references:

- `apps/api/src/promotion-service.ts` writes these fields into every promotion decision snapshot for standard, smart-form, and override promotion paths.
- `packages/contracts/src/promotion.ts` defines `PromotionDecisionSnapshot` and `extractScoreComponents`.
- `apps/api/src/promotion-edge-integration.test.ts` covers the UTV2-1327 enrichment behavior that this monitor observes.

## Metric Definitions

### Window

Default window: new promotion history rows with `promotion_decided_at >= now() - interval '24 hours'`.

The monitor should accept a configurable window, but dashboards and alerts should use 24 hours unless the incident runbook asks for a shorter burn-in window.

### Fallback Rate

Numerator:

- rows where `scoreInputs.edgeSourceQuality = 'confidence-fallback'`
- or `scoreInputs.edgeMethod = 'confidence-delta'`
- or `scoreInputs.providerCoverageState = 'none'` and `scoreInputs.edgeSourceQuality` is absent on older snapshots

Denominator:

- rows with a parseable `payload.scoreInputs` object and `promotion_decided_at` in the selected window

Formula:

```text
fallback_rate_pct = 100 * fallback_rows / parseable_rows
```

### Model-Driven Promotion-Score Percentage

Use the current best-bets weights:

| Component | Weight | Model-driven condition |
|---|---:|---|
| edge | 35 | `edgeSourceQuality in ('market-backed', 'explicit')` and `edgeMethod != 'confidence-delta'` |
| trust | 20 | score input present and not null |
| readiness | 20 | score input present and `readiness != 60` |
| uniqueness | 15 | `uniquenessInputs` present and `uniquenessFallbackReason` absent |
| boardFit | 10 | treat as model/runtime-driven when no explicit board-fit marker exists; future implementation may add a board-fit source field |

Formula per row:

```text
model_driven_weight_pct =
  edge_model_driven * 35 +
  trust_model_driven * 20 +
  readiness_model_driven * 20 +
  uniqueness_model_driven * 15 +
  board_fit_model_driven * 10
```

Aggregate:

```text
avg_model_driven_score_pct = avg(model_driven_weight_pct)
```

Rationale:

- Edge was the DEBT-019 concern and is only model-driven when backed by market data or an explicit audited source, not confidence delta.
- Readiness was the DEBT-020 concern; the historical fallback was the constant 60, so `readiness != 60` is the practical monitor signal after UTV2-1327.
- Uniqueness has an explicit fallback reason and input dimensions, so it can be classified directly.
- Board-fit currently lacks a source marker in the persisted snapshot; the monitor must call this out as a caveat instead of inventing precision.

## Read-Only SQL Sketch

```sql
with recent as (
  select
    id,
    pick_id,
    target,
    promotion_status,
    promotion_decided_at,
    payload->'scoreInputs' as score_inputs
  from pick_promotion_history
  where promotion_decided_at >= now() - interval '24 hours'
),
classified as (
  select
    *,
    score_inputs is not null as parseable,
    coalesce(score_inputs->>'edgeSourceQuality', '') as edge_source_quality,
    coalesce(score_inputs->>'edgeMethod', '') as edge_method,
    coalesce(score_inputs->>'providerCoverageState', '') as provider_coverage_state,
    score_inputs ? 'edgeFallbackReason' as has_edge_fallback_reason,
    score_inputs ? 'uniquenessFallbackReason' as has_uniqueness_fallback_reason,
    score_inputs ? 'uniquenessInputs' as has_uniqueness_inputs,
    nullif(score_inputs->>'readiness', '')::numeric as readiness_score
  from recent
)
select
  count(*) filter (where parseable) as parseable_rows,
  count(*) filter (
    where parseable
      and (
        edge_source_quality = 'confidence-fallback'
        or edge_method = 'confidence-delta'
        or (provider_coverage_state = 'none' and edge_source_quality = '')
      )
  ) as fallback_rows,
  round(
    100.0 * count(*) filter (
      where parseable
        and (
          edge_source_quality = 'confidence-fallback'
          or edge_method = 'confidence-delta'
          or (provider_coverage_state = 'none' and edge_source_quality = '')
        )
    ) / nullif(count(*) filter (where parseable), 0),
    2
  ) as fallback_rate_pct,
  round(avg(
    case when edge_source_quality in ('market-backed', 'explicit') and edge_method <> 'confidence-delta' then 35 else 0 end
    + 20
    + case when readiness_score is not null and readiness_score <> 60 then 20 else 0 end
    + case when has_uniqueness_inputs and not has_uniqueness_fallback_reason then 15 else 0 end
    + 10
  ), 2) as avg_model_driven_score_pct
from classified
where parseable;
```

## Output Contract

The monitor should emit a compact JSON object suitable for CI artifacts, Discord alerts, or dashboard ingestion:

```json
{
  "issue": "UTV2-1342",
  "windowHours": 24,
  "parseableRows": 0,
  "fallbackRows": 0,
  "fallbackRatePct": 0,
  "avgModelDrivenScorePct": 0,
  "edgeBreakdown": {
    "marketBacked": 0,
    "explicit": 0,
    "confidenceFallback": 0,
    "unknown": 0
  },
  "providerCoverage": {
    "pinnacle": 0,
    "consensus": 0,
    "sgo": 0,
    "singleBook": 0,
    "none": 0
  },
  "caveats": [
    "boardFit source is inferred until a board-fit source marker is persisted"
  ]
}
```

## Alert Guidance

Initial mode should be report-only. Suggested warning thresholds for later adoption:

- `fallbackRatePct > 25` for two consecutive windows: warn
- `fallbackRatePct > 50`: critical
- `avgModelDrivenScorePct < 75`: warn
- `parseableRows = 0`: no-data, not pass

Thresholds should not block promotion or distribution without a separate issue and PM approval.

## Non-Goals

- No changes to `bestBetsPromotionPolicy`.
- No changes to promotion gates or distribution routing.
- No new DB columns or migrations.
- No writes to production data.
- No reinterpretation of `approval_status` or `picks.status`.
