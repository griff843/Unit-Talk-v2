# Champion Model Registry Standard

**Issue:** UTV2-850  
**Status:** Governance standard — pre-implementation  
**Author:** Claude — 2026-05-07  
**Depends on:** UTV2-848 (provenance contract) + UTV2-849 (source-separated ledger) — both must be on `main`  
**Scope:** Defines the canonical champion model registry — entity types, required fields, lifecycle states, champion/challenger policy, pick attribution contract, historical attribution policy, and Codex implementation packet. No runtime behavior changes in this pass.

---

## Verified pre-conditions from UTV2-848 implementation pass

Before defining what the registry must become, the verified current state:

| Finding | Value |
|---|---|
| Total picks analyzed (30-day window) | 4,201 |
| Total pick_candidates in DB | 19,792 |
| model_attributed_pct | **0%** |
| candidate_linked_pct | 89.79% |
| source_separated_pct (canonical values) | **3.83%** |
| pick_candidates.provenance has model reference key | **false** |
| model_registry → pick_candidates FK or join path | **none found** |

**Actual `picks.source` values in the database:**

| Value | Count | UTV2-849 class |
|---|---|---|
| `system-pick-scanner` | 3,621 | `heuristic` (no registry link) |
| `smart-form` | 386 | `manual` |
| `board-construction` | 161 | `heuristic` (no registry link) |
| `api` | 28 | `manual` or `UNKNOWN` |
| `human` | 3 | `manual` |
| `canary-proof` | 2 | `synthetic` |

None of these are `model_generated` under the UTV2-849 classification, because no row in the database has a resolvable model_registry link. This is the gap UTV2-850 must close.

---

## 1. Purpose

The Champion Model Registry exists to make one thing possible:

> **"Which intelligence entity produced this pick, at what version, under what deployment state, and is this sufficient to evaluate model edge?"**

Without a functioning registry linked to actual picks and candidates, model-edge evaluation is invalid. Not weak — invalid. A win rate computed over a population of system-scanner picks that cannot be attributed to any specific model version is not model evidence. It is system evidence. The difference matters enormously.

### What the registry must answer for every model-attributed pick

1. Which named model/heuristic entity produced this pick?
2. Which version of that entity was active when the pick was scored?
3. What sport and market family does this entity own?
4. Was the entity champion, challenger, shadow, or retired at decision time?
5. Are the picks from this entity eligible for model-edge evaluation?
6. What feature set and training window was this entity trained on?
7. What validation evidence supported its current deployment state?

### Without registry attribution, the following are invalid

| Claim | Why invalid without registry |
|---|---|
| "The model has positive CLV" | Cannot separate model picks from heuristic/scanner picks |
| "Model A outperforms Model B" | Neither A nor B is linked to any specific pick population |
| "The champion model is calibrated" | Cannot link calibration scores to the picks it produced |
| "We have N model-generated picks" | 0% are currently model_generated under UTV2-849 classification |
| "The model's edge is degrading" | Cannot track per-model performance over time |
| "Syndicate-ready evidence exists" | Requires verifiable model attribution — currently absent |

### What registry PASS does NOT mean

A registry PASS — meaning a pick is fully attributed to a registered champion model — does not prove the model has edge. It proves model ownership is traceable enough to attempt an edge evaluation. Model quality is a downstream conclusion. Registry integrity is the prerequisite.

---

## 2. Canonical Registry Entity Types

### Master eligibility table

| Entity type | Meaning | Prod picks | ROI | CLV | Model-edge | Syndicate |
|---|---|---|---|---|---|---|
| `champion_model` | The current primary model for a sport/market_family; selected via promotion from challenger evaluation | Yes | PASS | PASS | PASS | PASS |
| `challenger_model` | A candidate model undergoing shadow or limited live evaluation against the champion | Yes (limited scope) | WARN | WARN | WARN (labeled) | No |
| `shadow_model` | A model evaluated in non-posting mode only; picks are never placed | No | No | No | Shadow-only plane | No |
| `heuristic_system` | A deterministic rule-based system; no statistical model scoring; no registry training window | Yes | WARN | WARN | No | No |
| `manual_strategy` | Human capper or operator judgment; no model or heuristic | Yes | WARN | WARN | No | No |
| `disabled_model` | A model that failed validation or exceeded degradation thresholds; picks blocked at ingestion | No | Historical only | Historical only | No | No |
| `retired_model` | A model that was champion and has since been replaced; picks remain in historical ledger | No | Historical only | Historical only | Historical only | No |
| `replay_model` | A model used for counterfactual replay simulation; picks are never placed live | No | No | No | No | No |
| `synthetic_model` | A model used for generating test or training data; picks are never placed live | No | No | No | No | No |

### 2.1 Mapping current picks.source values to entity types

Based on verified schema findings from UTV2-848:

| picks.source value | Maps to entity type | Condition |
|---|---|---|
| `system-pick-scanner` | `heuristic_system` | No model_registry link; scanner is rule/score-based but unattributed |
| `system-pick-scanner` | `champion_model` | Only if model_registry FK is established and entity is champion — currently impossible |
| `board-construction` | `heuristic_system` | Same condition as scanner |
| `smart-form` | `manual_strategy` | User-submitted via UI |
| `api` | `manual_strategy` or `UNKNOWN` | Depends on API caller identity — not currently tracked |
| `human` | `manual_strategy` | Explicit human label |
| `canary-proof` | `synthetic_model` | Canary/test rows |

The practical effect: **until UTV2-850 establishes the FK from pick_candidates to model_registry, all 3,621 `system-pick-scanner` picks are `heuristic_system`, not `champion_model`.** This is not a failure of the scanner — it is the absence of attribution infrastructure.

---

## 3. Required Registry Fields

### 3.1 Core identity fields

| Field | Type | Meaning | Required | Immutable | Model-edge req. |
|---|---|---|---|---|---|
| `model_id` | uuid | Primary key | Yes | Yes | Yes |
| `model_name` | text | Human-readable name (e.g., "NBA_spread_v2") | Yes | No | Yes |
| `model_version` | text | Semantic version string (e.g., "2.1.4") | Yes | No | Yes |
| `registry_entity_type` | enum | One of the nine entity types in §2 | Yes | No | Yes |
| `source_type_compatibility` | text[] | Which `picks.source` values this entity owns (e.g., `['system-pick-scanner']`) | Yes | No | Yes |
| `sport` | text | Sport scope (e.g., "NBA", "NFL") | Yes | Yes | Yes |
| `market_family` | text | Market family scope (e.g., "spread", "total") | Yes | Yes | Yes |

### 3.2 Feature and training fields

| Field | Type | Meaning | Required | Immutable | Model-edge req. |
|---|---|---|---|---|---|
| `feature_set_id` | uuid | FK → feature registry (future) | Yes for `champion_model` | Yes | Yes |
| `feature_set_version` | text | Version of the feature set at training time | Yes for `champion_model` | Yes | Yes |
| `training_window_start` | timestamptz | Earliest training data date | Yes for `champion_model` | Yes | Yes |
| `training_window_end` | timestamptz | Latest training data date | Yes for `champion_model` | Yes | Yes |
| `validation_window_start` | timestamptz | Start of validation/holdout period | Yes for `champion_model` | Yes | Yes |
| `validation_window_end` | timestamptz | End of validation/holdout period | Yes for `champion_model` | Yes | Yes |

Optional for `heuristic_system` and `manual_strategy` — these entities do not have training windows. If present, they describe the period over which the rule was calibrated. If absent, that is acceptable.

### 3.3 Deployment and lifecycle fields

| Field | Type | Meaning | Required | Immutable | Prod-readiness req. |
|---|---|---|---|---|---|
| `deployment_start` | timestamptz | When this entity began producing live picks | Yes | No | Yes |
| `deployment_end` | timestamptz | When this entity stopped producing live picks (null if active) | No | No | Yes |
| `active_state` | enum | Current lifecycle state (see §4) | Yes | No | Yes |
| `owner` | text | Team or individual responsible for this entity | Yes | No | No |
| `rollback_target` | uuid | FK → model_registry; which entity to restore if this one is disabled | No | No | No |
| `retirement_reason` | text | Why the entity was retired or disabled | No for active | Yes once set | No |

### 3.4 Scope control fields

| Field | Type | Meaning | Required | Immutable | Syndicate req. |
|---|---|---|---|---|---|
| `allowed_market_families` | text[] | Exhaustive list of market families this entity is authorized to score | Yes | No | Yes |
| `blocked_market_families` | text[] | Market families explicitly blocked even if the entity would score them | No | No | Yes |
| `allowed_sports` | text[] | If entity is multi-sport, list all authorized sports | Yes | No | Yes |

### 3.5 Evaluation and calibration fields

| Field | Type | Meaning | Required | Immutable | Model-edge req. |
|---|---|---|---|---|---|
| `calibration_metadata` | jsonb | Calibration method, scores, and evaluation date | Yes for `champion_model` | No | Yes |
| `validation_metrics` | jsonb | CLV, ROI, Brier, drawdown, sample size from validation window | Yes for `champion_model` | Yes (snapshot at promotion) | Yes |
| `promotion_status` | enum | `draft` \| `pending_review` \| `approved` \| `rejected` | Yes | No | No |
| `promotion_approved_by` | text | Identity of the PM or operator who approved promotion | Yes for champion | Yes | Yes |
| `promotion_approved_at` | timestamptz | Timestamp of promotion approval | Yes for champion | Yes | Yes |

### 3.6 Immutability rules

Fields marked immutable must not be updated after the entity first reaches `champion` state. Fields marked mutable (like `active_state`, `deployment_end`, `allowed_market_families`) can change as the entity moves through its lifecycle. `validation_metrics` is immutable as a snapshot — the snapshot taken at promotion time is preserved permanently, even as the model continues to accumulate live performance data.

---

## 4. Model Lifecycle States

### States

| State | Meaning | Produces picks | Model-edge eligible |
|---|---|---|---|
| `draft` | Entity exists in registry but is not yet validated or deployed | No | No |
| `validated` | Passed offline validation; training/validation windows complete and documented | No | No |
| `shadow` | Active in shadow mode; scores candidates but picks are not posted | Shadow only | Shadow plane only |
| `challenger` | Active in limited live deployment alongside champion; scoped to defined market subset | Yes (scoped) | WARN (labeled) |
| `champion` | Primary active entity for its sport/market_family; unrestricted within its allowed scope | Yes | Yes |
| `degraded` | Champion that has exceeded degradation thresholds but not yet disabled; operator-flagged | Yes (with alert) | WARN |
| `disabled` | Production picks blocked; triggered by hard degradation threshold or security event | No | No (historical only) |
| `retired` | Formerly champion; cleanly decommissioned; not disabled; historical picks remain valid | No | Historical only |

### Allowed transitions

```
draft → validated
validated → shadow
shadow → challenger
challenger → champion
champion → degraded
degraded → champion      (recovery — degradation reversed)
degraded → disabled
champion → disabled      (emergency path — skip degraded)
champion → retired       (clean decommission)
challenger → retired     (challenger not selected)
shadow → retired         (shadow evaluation ended)
```

### Invalid transitions and reasons

| Transition | Reason invalid |
|---|---|
| `draft → champion` | Cannot skip validation; unvalidated models must not produce production picks |
| `draft → shadow` | Validation must precede any pick-scoring activity |
| `disabled → champion` | A disabled model cannot be re-promoted; must create a new registry entry (new model_version) after root cause is resolved |
| `retired → any` | Retirement is terminal; a returned capability requires a new registry entry |
| `heuristic_system → champion_model` | Entity type is immutable; a heuristic cannot become a model by lifecycle transition |
| Any state → `draft` | Draft is an entry state, not a reset target |

### Transition evidence requirements

| Transition | Required evidence before transition is permitted |
|---|---|
| `validated → shadow` | Training window documented; feature set linked; validation metrics present |
| `shadow → challenger` | Shadow evaluation summary with CLV distribution, sample size ≥ threshold (to be defined in UTV2-851 thresholds doc), no critical calibration failure |
| `challenger → champion` | Challenger evaluation meeting promotion criteria (§5); PM `promoted-to-champion` label on approval PR; `promotion_approved_by` and `promotion_approved_at` populated |
| `champion → degraded` | Automated or operator-triggered degradation flag with reason |
| `degraded → disabled` | Operator decision with `retirement_reason` logged |
| `champion → retired` | Operator decision; successor champion identified or explicitly none |

---

## 5. Champion / Challenger Policy

### 5.1 What makes a model champion

A model achieves `champion` status via an explicit promotion workflow, not by default or by being the only registered model. An uncontested heuristic system that happens to be producing picks is a `heuristic_system`, not a `champion_model`.

Promotion requires:
1. The entity is in `challenger` state
2. Challenger evaluation period has completed (minimum duration TBD in thresholds doc)
3. PM has reviewed evaluation evidence and applied the `promoted-to-champion` label
4. The existing champion (if any) transitions to `retired` in the same approval action
5. `promotion_approved_by`, `promotion_approved_at` are recorded in the registry

**There can be at most one `champion_model` per (sport, market_family) scope at any time.** Two simultaneous champions in the same scope is a schema violation, not a feature.

### 5.2 Champion/challenger evaluation evidence categories

The following evidence categories must exist before promotion can be approved. Final threshold values are deferred to a future thresholds document. The categories are not.

| Evidence category | Evaluation description |
|---|---|
| CLV | Closing-line value distribution over the challenger evaluation window |
| ROI (actual) | Realized return on investment over settled picks in evaluation window |
| Calibration | Predicted win probability vs actual win frequency (Brier score or equivalent) |
| Drawdown | Maximum sequential loss streak and drawdown magnitude |
| Sample size | Minimum number of settled picks in evaluation window (prevents small-sample promotion) |
| Sport/market coverage | % of target sport/market_family picks covered by this entity |
| Runtime freshness | Scheduler and provider freshness dimensions from UTV2-847 during evaluation window |
| Provenance coverage | % of evaluation-window picks with complete provenance attribution |
| Shadow agreement | Agreement rate between shadow and live picks (for shadow-to-challenger transitions) |

None of these categories may be skipped. A model with excellent ROI but insufficient sample size does not qualify for promotion.

### 5.3 How challengers differ from shadow models

| Dimension | `challenger_model` | `shadow_model` |
|---|---|---|
| Picks are posted live | Yes (within scoped market subset) | No |
| Included in production ROI | Yes (WARN — labeled) | No |
| Included in CLV sample | Yes (WARN — labeled) | No |
| Can be promoted to champion | Yes | No (must transition to challenger first) |
| Evaluation plane | Live production (labeled as challenger) | Shadow-only |

### 5.4 When a champion must be degraded

Degradation is triggered automatically or by operator when:
- Brier score exceeds degradation threshold in the rolling evaluation window
- ROI falls below degradation floor over the defined trailing period
- A provider or market change renders the model's feature inputs stale or invalid
- A data pipeline failure contaminates the model's scoring inputs
- The model's CLV distribution inverts (picks with negative expected value)

Degradation does not immediately block picks. It triggers an alert and flags the entity as `degraded`. The operator decides whether to disable or allow continued operation with explicit acknowledgment.

### 5.5 When rollback occurs

If a `champion_model` is disabled after a failed transition, the `rollback_target` field identifies which registry entry to restore. Rollback:
- Re-activates the rollback target entity in `champion` state
- Does not retroactively alter pick attribution for picks produced during the failed champion's window
- Does not fabricate attribution for the gap period between the failed champion and the rollback

---

## 6. Pick Attribution Contract

### 6.1 Minimum required attribution fields per pick

For a pick to be classified as `model_generated` under UTV2-849 and model-edge eligible under UTV2-847, the following must be resolvable at query time:

| Field | Source | Required for |
|---|---|---|
| `pick_id` | `picks.id` | All attribution |
| `candidate_id` | `pick_candidates.id` via `pick_candidates.pick_id` join | model_generated, heuristic |
| `source_type` | `picks.source` (canonical value) | All attribution |
| `registry_entity_id` | New: FK from `pick_candidates` to `model_registry.id` | model_generated only |
| `model_id` | `model_registry.id` or `model_registry.model_name` + `model_version` | model-edge, syndicate |
| `model_version` | `model_registry.model_version` | model-edge, syndicate |
| `score_snapshot` | `pick_candidates.model_score` + `model_confidence` + `model_tier` | model-edge |
| `feature_snapshot_id` | New: FK from `pick_candidates` to feature snapshot (future scope) | syndicate (deferred) |
| `decision_timestamp` | `pick_candidates.created_at` or `picks.created_at` | model-edge |

### 6.2 The critical missing link

The UTV2-848 proof pass confirmed: `pick_candidates.provenance` JSONB contains **no model reference keys**. The `model_registry` table has no FK to or from `pick_candidates`.

**UTV2-850 implementation must add a `model_registry_id` column to `pick_candidates`** (or an equivalent attribution table) so that when the scanner scores a candidate, it records which registry entry performed the scoring.

This is a schema migration. It must not be added by the Codex proof pass. It must be explicitly approved by the operator before the implementation lane opens.

Until this FK exists:
- `source_type = 'system-pick-scanner'` picks are `heuristic_system`, not `model_generated`
- `model_attributed_pct` remains 0%
- model-edge evaluation remains invalid

### 6.3 Attribution requirements by entity type

| Entity type | picks.source required value | Registry FK required | score_snapshot required | Notes |
|---|---|---|---|---|
| `champion_model` | `system-pick-scanner` or `board-construction` (after 849 canonical enforcement) | Yes — `pick_candidates.model_registry_id` | Yes | No FK → not model_generated |
| `challenger_model` | Same as champion | Yes | Yes | Labeled as challenger in reports |
| `shadow_model` | Any (shadow mode) | Yes | Yes | `pick_candidates.shadow_mode = true` |
| `heuristic_system` | `system-pick-scanner` or `board-construction` | Optional | Optional | FK absent → defaults here |
| `manual_strategy` | `smart-form`, `human`, `api` | No | No | No registry requirement |
| `disabled_model` | Blocked at ingestion | N/A | N/A | Picks must not be created |
| `retired_model` | Historical only | Historical FK if it existed | Historical | Attribution preserved |

### 6.4 Manual/heuristic rows must not masquerade as model_generated

This is an explicit invariant. A pick is `model_generated` if and only if:

1. `pick_candidates` has a row with `pick_id` linking to this pick
2. That candidate row has a non-null `model_registry_id`
3. The `model_registry_id` references a registry entry with `registry_entity_type` in (`champion_model`, `challenger_model`, `shadow_model`)
4. That registry entry is in an active state for the decision timestamp

Any pick that fails any of these four conditions is not `model_generated`. Inferences, approximations, and heuristic mappings do not satisfy these conditions.

---

## 7. Historical Attribution Policy

### 7.1 All 4,201 existing picks are in UNKNOWN model state

Based on UTV2-848 findings, no existing pick in the 30-day window has model attribution. `model_attributed_pct = 0%`. This is the baseline.

Historical rows are permanently UNKNOWN for model attribution unless a verifiable evidence chain links them to a specific registry entry. The evidence chain must include:

- A real `pick_candidates` row with a real `model_registry_id` value
- That registry entry must have been in an active, production-eligible state at `pick_candidates.created_at`
- The attribution must not be reconstructed from score values alone

### 7.2 What is permitted for historical rows

| Action | Permitted |
|---|---|
| Classify as `UNKNOWN` for model attribution | Yes |
| Count historical UNKNOWN rows in `model-attribution-gaps.csv` | Yes |
| Classify by `picks.source` value using the entity type mapping in §2.1 | Yes (read-only) |
| Preserve historical picks as `heuristic_system` based on `system-pick-scanner` value | Yes |
| Use historical ROI and CLV data for heuristic performance review | Yes (with WARN caveat) |

### 7.3 What is forbidden for historical rows

| Action | Forbidden |
|---|---|
| Writing `model_registry_id` to historical `pick_candidates` rows without a real evidence chain | Forbidden |
| Inferring which model produced a pick from its score value or model_tier | Forbidden — scores are not unique to a registry entry |
| Classifying historical scanner picks as `model_generated` because a model existed at that time | Forbidden — existence ≠ attribution |
| Bulk-linking all historical scanner picks to the "most likely" model | Forbidden — fabrication |
| Treating UNKNOWN model attribution as WARN in model-edge evaluation | Forbidden — UNKNOWN = FAIL for model-edge |

### 7.4 Historical contamination is permanent and measurable

The 4,201-pick UNKNOWN baseline is a permanent fact about the current ledger. As UTV2-850 enforcement goes live, new picks will accumulate model attribution. Old picks will not.

This means model-edge evaluation will initially have very small sample sizes — only picks created after UTV2-850 goes live. That is the correct constraint. A small sample of real model-attributed picks is worth more than a large sample of UNKNOWN-attributed picks.

---

## 8. Relationship to Existing Standards

### 8.1 Dependencies (what UTV2-850 requires)

| Standard | Dependency |
|---|---|
| **UTV2-847** (truthworthiness) | The `model-attributed` dimension scores as FAIL if `model_registry_id` is absent. UTV2-850 is what makes this dimension eventually PASS. |
| **UTV2-848** (provenance contract) | Provenance is a prerequisite for model attribution. A pick without a candidate link cannot have a registry link. UTV2-848 defines the candidate linkage policy. |
| **UTV2-849** (source-separated ledger) | The `model_generated` source class requires a registry FK. UTV2-849 defines the classification rules; UTV2-850 makes the FK exist. |

### 8.2 What UTV2-850 enables downstream

| Future issue | Dependency on 850 |
|---|---|
| **UTV2-851** (unsupported-market quarantine) | Market quarantine must respect which entity is champion for which market family. Registry scope fields (`allowed_market_families`, `blocked_market_families`) are defined here. |
| Champion/challenger evaluation | Cannot run without a champion entity being registered and linked to picks |
| Model drift detection | Cannot detect drift without a per-entity performance time series — which requires per-entity pick attribution |
| Model-edge evaluation | Cannot run at all without `model_attributed_pct > 0%` |
| Syndicate-readiness evidence | Cannot be proven without model attribution — syndicate requires PASS on all 15 UTV2-847 dimensions |

---

## 9. Required Reporting

### Output location

```
docs/06_status/proof/model-registry/
  model-registry-summary.json
  model-registry-entries.csv
  model-attribution-coverage.csv
  model-performance-readiness.csv
  champion-challenger-status.csv
  model-attribution-gaps.csv
  README.md
```

### model-registry-summary.json schema (version 1)

```json
{
  "schema_version": 1,
  "generated_at": "<ISO timestamp>",
  "evaluation_window": {
    "from": "<ISO timestamp>",
    "to": "<ISO timestamp>",
    "days": 30
  },
  "system_verdict": "PASS | WARN | FAIL",
  "registry_state": {
    "total_registry_entries": 0,
    "champion_count": 0,
    "challenger_count": 0,
    "shadow_count": 0,
    "heuristic_count": 0,
    "manual_count": 0,
    "disabled_count": 0,
    "retired_count": 0,
    "sports_covered": [],
    "market_families_covered": []
  },
  "attribution_coverage": {
    "total_picks_analyzed": 0,
    "model_attributed_count": 0,
    "model_attributed_pct": 0.0,
    "champion_attributed_pct": 0.0,
    "challenger_attributed_pct": 0.0,
    "shadow_attributed_pct": 0.0,
    "heuristic_owned_pct": 0.0,
    "unknown_model_ownership_pct": 0.0,
    "retired_disabled_exposure_pct": 0.0
  },
  "model_edge_eligibility": {
    "eligible_rows": 0,
    "eligible_pct": 0.0,
    "ineligible_rows": 0,
    "reason_breakdown": {
      "no_registry_fk": 0,
      "entity_type_ineligible": 0,
      "state_ineligible": 0,
      "unknown_source": 0
    }
  },
  "schema_findings": {
    "model_registry_table_exists": true,
    "pick_candidates_has_model_registry_id_column": false,
    "model_registry_columns_verified": [],
    "existing_registry_entries": 0,
    "pick_candidates_to_registry_join_path": "none",
    "migration_needed_for_registry_fk": true
  }
}
```

### model-registry-entries.csv

Columns: `model_id`, `model_name`, `model_version`, `registry_entity_type`, `sport`, `market_family`, `active_state`, `deployment_start`, `deployment_end`, `allowed_market_families`, `champion_since`, `owner`

One row per registry entry. Reports the current state of `model_registry` as found in the database.

### model-attribution-coverage.csv

Columns: `source_value`, `entity_type`, `pick_count`, `model_attributed_count`, `model_attributed_pct`, `registry_fk_present`, `model_edge_eligible`

One row per distinct `picks.source` value. Shows which source populations have attribution and which do not.

### model-performance-readiness.csv

Columns: `model_id`, `model_name`, `model_version`, `sport`, `market_family`, `active_state`, `validation_metrics_present`, `calibration_metadata_present`, `training_window_complete`, `promotion_status`, `model_edge_ready`

One row per registry entry that is in `champion`, `challenger`, or `shadow` state.

### champion-challenger-status.csv

Columns: `sport`, `market_family`, `champion_model_id`, `champion_model_name`, `champion_since`, `challenger_model_id`, `challenger_model_name`, `shadow_model_id`, `shadow_model_name`, `has_contested_champion`

One row per (sport, market_family). Identifies which scopes have a champion and whether any challenger or shadow evaluation is active.

### model-attribution-gaps.csv

Columns: `picks_source_value`, `pick_count`, `gap_type`, `gap_description`, `resolution_required`

One row per gap type per source value. Documents what attribution infrastructure is missing and what must be built to close each gap.

### README.md

Must contain:
- Generation timestamp
- Evaluation window
- System verdict with one-sentence explanation
- Registry state table (all entity types, counts)
- Attribution coverage summary
- Top 3 attribution gaps by pick count
- Explicit statement: "Registry PASS does not prove model edge."
- Explicit statement: "0% model attribution at baseline — all scanner picks are heuristic_system until pick_candidates.model_registry_id FK is established."

---

## 10. PASS / WARN / FAIL Verdicts

### PASS

A registry PASS means model attribution exists at a level sufficient to attempt model-edge evaluation.

Conditions:
- At least one `champion_model` entry exists in `model_registry`
- That entry is linked to picks via `pick_candidates.model_registry_id`
- `model_attributed_pct` ≥ 50% of picks in the evaluation window
- The champion's `validation_metrics` are present and the `promotion_approved_by` field is populated
- No simultaneous champion entries for the same (sport, market_family) scope

A PASS does not mean the model has edge. It means attribution is traceable enough to evaluate edge.

### WARN

- Registry entries exist but `model_attributed_pct` is > 0% and < 50%
- A challenger or shadow entity exists but no champion is designated
- Validation metrics are present but the promotion approval record is incomplete
- The champion's `deployment_start` is recent (< 30 days) and the evaluation window is too short for statistical conclusions

WARN means attribution exists but coverage is insufficient for confident model-edge conclusions.

### FAIL

Current state: **FAIL**.

Conditions for FAIL (any of):
- `pick_candidates.model_registry_id` column does not exist (verified: does not exist)
- `model_attributed_pct = 0%` (verified: 0%)
- No `champion_model` entry with linked picks
- Multiple simultaneous champion entries for the same scope
- Champion validation metrics absent

A registry FAIL means model-edge evaluation is invalid for the current pick population. Not weak — invalid.

### The distinction

Registry FAIL → "We cannot evaluate whether the model has edge because we cannot identify which picks the model produced."

This is distinct from: "The model has no edge." We do not know whether it has edge. We cannot know. That is what makes a FAIL different from a PASS with negative results.

---

## 11. Unresolved Schema Questions

These require Codex verification at implementation time.

| Question | Impact | How to resolve |
|---|---|---|
| Does `model_registry` currently have `status` or `active_state` column? The generated types show `status` but UTV2-847 standard references `active_state`. | Determines whether a migration is needed for lifecycle state | `SELECT column_name FROM information_schema.columns WHERE table_name = 'model_registry'` |
| Are there any existing rows in `model_registry`? | Determines whether any champion/challenger is registered at all | `SELECT COUNT(*) FROM model_registry` |
| Does `pick_candidates` have a `model_registry_id` or any model FK column? | Core finding — if yes, update standard; if no (expected), document the migration needed | Column query on `pick_candidates` |
| What is the current `model_registry.status` enum or text values? | Determines mapping to lifecycle states defined in §4 | `SELECT DISTINCT status FROM model_registry` |
| Does `pick_candidates.provenance` JSONB have any sub-key that could be interpreted as a model hint, even if not a registry FK? | Determines whether partial historical attribution is possible | `SELECT provenance FROM pick_candidates WHERE provenance IS NOT NULL LIMIT 20` |

---

## 12. Codex Implementation Packet

**Dispatch condition:** UTV2-849 must be merged and confirmed on `origin/main`. This standard must also be on `main`. Verify both before starting.

**This is a proof/report pass only. No migrations. No writes to `pick_candidates`, `model_registry`, or `picks`.** The schema migration to add `pick_candidates.model_registry_id` is explicitly deferred — it requires operator approval and a separate implementation lane.

---

```
Issue: UTV2-850 — Champion Model Registry Standard
Branch: codex/utv2-850-champion-model-registry
Depends on: UTV2-849 merged on main — confirm before starting

## Task

Implement a read-only proof/report script that:
1. Verifies the current state of model_registry table and schema
2. Detects whether any model attribution FK exists (expected: none)
3. Classifies all picks in the evaluation window by entity type (using §2.1 mapping)
4. Produces machine-readable registry gap artifacts
5. Documents what migrations are needed before model attribution is possible

Do not add any migration.
Do not write to model_registry, pick_candidates, or picks.
Do not fabricate model attribution.
Do not create registry entries for historical scanner picks.

## Entry point

scripts/model-registry/run-registry-report.ts

Run as: npx tsx scripts/model-registry/run-registry-report.ts
Optional flag: --days 30 (evaluation window, default 30)

## Schema verification (do this first, before implementing anything)

Step 1 — verify model_registry columns:

  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_name = 'model_registry'
  ORDER BY column_name;

Step 2 — verify existing model_registry rows:

  SELECT
    id, model_name, version, sport, market_family, status,
    champion_since, created_at
  FROM model_registry
  ORDER BY created_at DESC;

Step 3 — verify pick_candidates for any model FK column:

  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_name = 'pick_candidates'
    AND column_name ILIKE '%model%'
  ORDER BY column_name;

  -- Also check for any registry FK:
  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_name = 'pick_candidates'
    AND column_name ILIKE '%registry%'
  ORDER BY column_name;

Step 4 — sample pick_candidates.provenance JSONB for any model hints:

  SELECT provenance
  FROM pick_candidates
  WHERE provenance IS NOT NULL
  LIMIT 20;

  -- Extract all distinct top-level keys from provenance JSONB:
  SELECT DISTINCT jsonb_object_keys(provenance) as key
  FROM pick_candidates
  WHERE provenance IS NOT NULL
  ORDER BY key;

Step 5 — verify picks.source distribution (expected from UTV2-848):

  SELECT source, COUNT(*) as count
  FROM picks
  WHERE created_at > NOW() - INTERVAL '30 days'
  GROUP BY source
  ORDER BY count DESC;

Record all findings in schema_findings section of model-registry-summary.json.

## Pick classification logic (read-only)

For each pick in the evaluation window, determine entity_type using §2.1 mapping:

  'system-pick-scanner' → 'heuristic_system'
    (unless pick_candidates.model_registry_id exists and is non-null
     — if this column exists, report it as a finding and classify accordingly)
  'board-construction'  → 'heuristic_system' (same condition)
  'smart-form'          → 'manual_strategy'
  'api'                 → 'manual_strategy'
  'human'               → 'manual_strategy'
  'canary-proof'        → 'synthetic_model'
  null                  → 'UNKNOWN'
  any other value       → 'UNKNOWN' (record in schema_findings)

Do not classify any pick as 'champion_model' or 'model_generated' unless
pick_candidates has a non-null model_registry_id and that ID resolves to a
model_registry entry with registry_entity_type in
(champion_model, challenger_model, shadow_model).

If pick_candidates.model_registry_id does not exist as a column:
  - Record: schema_findings.pick_candidates_has_model_registry_id_column = false
  - Record: schema_findings.migration_needed_for_registry_fk = true
  - Classify all scanner/board picks as 'heuristic_system'

## Attribution coverage calculation

For each entity type classification:
  - Count picks
  - Compute pct of total
  - Compute model_edge_eligible (true only for champion_model, false otherwise)

model_attributed_pct = picks with entity_type in (champion_model, challenger_model) / total
unknown_model_ownership_pct = picks with entity_type = UNKNOWN / total
heuristic_owned_pct = picks with entity_type = heuristic_system / total

## Gap documentation

For each source value with zero model attribution, produce a row in
model-attribution-gaps.csv:

  picks_source_value: 'system-pick-scanner'
  pick_count: <actual count>
  gap_type: 'missing_registry_fk'
  gap_description: 'pick_candidates has no model_registry_id column; all scanner picks are heuristic_system'
  resolution_required: 'Add pick_candidates.model_registry_id FK (requires migration); populate at candidate scoring time'

Produce one row per distinct gap type per source value.

## Output files — all required

  docs/06_status/proof/model-registry/model-registry-summary.json
  docs/06_status/proof/model-registry/model-registry-entries.csv
  docs/06_status/proof/model-registry/model-attribution-coverage.csv
  docs/06_status/proof/model-registry/model-performance-readiness.csv
  docs/06_status/proof/model-registry/champion-challenger-status.csv
  docs/06_status/proof/model-registry/model-attribution-gaps.csv
  docs/06_status/proof/model-registry/README.md

JSON schema is in §9 of the standard. Match exactly. schema_version must be 1.

## Implementation rules

1. Read-only. No writes to any table.
2. Use the existing Supabase client from packages/db.
3. Record all schema findings accurately — especially pick_candidates column inventory.
4. If model_registry is empty (0 rows), that is not an error — report it and continue.
5. If pick_candidates has no model FK column, that is not an error — report and continue.
6. model-performance-readiness.csv may have 0 rows if no champion/challenger/shadow entries exist.
7. champion-challenger-status.csv must have a row per (sport, market_family) scope,
   even if all fields are null/empty for that scope.
8. README must include the baseline statement: "0% model attribution at baseline."

## Do NOT

- Add any migration or ALTER TABLE statement
- Write to any production table
- Classify any pick as champion_model or model_generated without a verified registry FK
- Create synthetic registry entries for historical scanner picks
- Claim model edge in any output
- Infer model attribution from score values, model_tier, or model_confidence fields alone
- Require a minimum live sample to run — script must complete even if all samples are INSUFFICIENT

## Verification steps (all required)

1. pnpm type-check — must pass
2. Write tests at scripts/model-registry/run-registry-report.test.ts:
   - Verifies all seven output files are created
   - Verifies model-registry-summary.json has schema_version: 1 and all required fields
   - Verifies schema_findings section is present and populated
   - Verifies model-attribution-coverage.csv has a header row
   - Verifies model-attribution-gaps.csv has a header row
   - Verifies no string "model has edge" appears in any output file
   - Verifies no string "champion_model" appears in model-attribution-coverage.csv
     unless pick_candidates.model_registry_id column exists and is populated
3. pnpm test:db — must pass
4. pnpm verify — must pass

## Stop conditions

Stop and escalate to operator if:
- model_registry table does not exist
- pick_candidates table does not exist
- picks table does not exist
- Any required output directory cannot be written
- A column query returns an unexpected schema error

Report the stop condition, the query, and the error. Do not work around silently.

## Expected findings (do not treat as authoritative — verify from real queries)

Based on UTV2-848 evidence.json:
  - model_registry has no FK to pick_candidates (confirmed)
  - pick_candidates.provenance has no model reference keys (confirmed)
  - picks.source distribution: system-pick-scanner (3621), smart-form (386),
    board-construction (161), api (28), human (3), canary-proof (2)
  - Expected model_attributed_pct: 0%
  - Expected heuristic_owned_pct: ~90%+ (scanner + board-construction)
  - Expected model_registry rows: unknown — verify from live DB

Do not pre-populate any metric. Score from real queries only.
```
