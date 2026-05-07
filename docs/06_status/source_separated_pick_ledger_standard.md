# Source-Separated Pick Ledger Standard

**Issue:** UTV2-849  
**Status:** Governance standard — pre-implementation  
**Author:** Claude — 2026-05-07  
**Depends on:** UTV2-848 (provenance contract standard) — must be on `main` before Codex dispatch  
**Scope:** Defines canonical source types, separation policy, trusted/untrusted rules, runtime enforcement semantics, and Codex implementation packet. No runtime behavior changes in this pass.

---

## 1. Purpose

Source separation exists to prevent pick populations of fundamentally different origin from contaminating each other's analytics.

### Why mixed populations corrupt analytics

A heuristic pick is **not** a model pick.  
A manual pick is **not** a model pick.  
A shadow pick is **not** a production pick.

When these populations are mixed in a single analytics query, the result is a composite number that answers no coherent question. A sample containing 80% manual picks and 20% model-generated picks does not tell you whether the model has edge. It tells you that the combined population of humans and algorithms, under uncontrolled conditions, achieved some aggregate result.

Specific corruption patterns:

| Mix | Corruption |
|---|---|
| Manual + model in ROI sample | ROI reflects human judgment + algorithm; cannot isolate model contribution |
| Shadow + production in CLV sample | CLV includes bets that were never actually placed; inflates or deflates closing-line metrics |
| Heuristic + model in model-edge sample | Edge attributed to the model may belong to the rule |
| Unsupported-market picks in CLV sample | No closing line exists; CLV is undefined or fabricated |
| Operator-edited picks in model-edge sample | Post-hoc operator judgment contaminates the model's original signal |
| Imported historical + live picks | Historical picks may have been created under different conditions, different markets, or different staking logic |
| Replay + production | Replay picks are counterfactual — they represent what would have happened, not what did |

### Why model-edge evaluation requires source isolation

Model-edge evaluation asks: **does this specific model, applied to this specific market under these specific conditions, produce positive expected value?**

This question is only answerable if:

1. The pick population is exclusively model-generated picks
2. Every pick in the sample was actually placed (not shadow, not replay)
3. The market was supported and CLV-computable at the time of posting
4. The staking logic was canonical and attributable to the model's output
5. No operator override altered the selection, line, or odds after model scoring

Without source separation, none of these conditions can be verified.

### The separation principle

Each pick has one source class, set at creation, immutable after posting. Analytics filters are applied per source class. No source class is silently merged into another for analytical convenience.

---

## 2. Canonical Source Types

### Master classification table

| Source class | Meaning | ROI | CLV | Model-edge | Prod-readiness | Syndicate |
|---|---|---|---|---|---|---|
| `model_generated` | Produced by a scored model in the candidate pipeline; model_registry link must exist | Yes (trusted) | Yes (trusted) | Yes (trusted) | Yes | Yes |
| `heuristic` | Rule-based selection; no model scoring; no registry link | Yes (caveated) | Yes (caveated) | No | Yes | No |
| `manual` | Operator/capper entered directly; bypasses candidate pipeline entirely | Yes (caveated) | Yes (caveated) | No | Yes | No |
| `shadow` | Model or heuristic evaluation in non-posting mode; pick was never placed | No | No | No (see §2.1) | No | No |
| `operator_edited` | Any source type, post-creation modified by an operator | Yes (original values only, with caveat) | Yes (original values only, with caveat) | No | Yes (caveated) | No |
| `unsupported_market` | Market not present in `market_universe`; CLV undefined | Yes (no CLV) | No | No | No | No |
| `replay` | Counterfactual; simulates what would have happened under different conditions | No | No | No (see §2.2) | No | No |
| `synthetic` | Generated for testing, training, or simulation; never placed | No | No | No | No | No |
| `imported_historical` | Migrated from a legacy system with partial or unknown provenance | Yes (with UNKNOWN caveat) | Maybe (see §2.3) | No | No | No |

### 2.1 Shadow picks and model evaluation

Shadow picks are excluded from production ROI, CLV, and live model-edge evaluation. However, shadow picks may be used for **shadow model evaluation** — a separate, explicitly labeled analytics plane that answers "what would this model have achieved if it had been live?"

Shadow model evaluation is not model-edge evaluation. It must be labeled separately and may not be used as evidence of production edge.

### 2.2 Replay picks and model evaluation

Replay picks simulate past decisions using current or hypothetical models. They are explicitly counterfactual. Replay results must never be merged with live production results, even to improve apparent sample size.

Replay analytics are a separate research tool, not production evidence.

### 2.3 Imported historical picks and CLV

An imported historical pick may have CLV if the original pick's market and closing-line offer can be joined to a `provider_offers` row with `is_closing = true`. If this join fails, the pick has no CLV and must be scored as `no-clv` on the CLV-backed dimension.

CLV for imported historical picks is never fabricated from estimated or reconstructed prices.

### 2.4 Reconciliation with UTV2-848 canonical source_type values

UTV2-848 defined the following canonical values for `picks.source`:

| UTV2-848 value | Maps to UTV2-849 source class | Notes |
|---|---|---|
| `user-submitted` | `manual` | User submissions are human-originated; excluded from model-edge |
| `system-scanner` | `model_generated` OR `heuristic` | Depends on whether the scanner used scored candidates with a registry link. Codex must verify at implementation time. |
| `board-construction` | `model_generated` OR `heuristic` | Same distinction: model-scored board picks → `model_generated`; rule-based board picks → `heuristic` |
| `manual` | `manual` | Direct mapping |
| `heuristic` | `heuristic` | Direct mapping |
| `operator-edited` | `operator_edited` | Direct mapping |

**The UTV2-848 values are the provenance origin layer. The UTV2-849 classes are the analytical classification layer.** The two layers are related but not identical. Implementation must map origin values to analytical classes using the candidate pipeline join — not string matching alone.

---

## 3. Immutable Source Policy

### 3.1 Source type is set at creation

The source class of a pick is determined at creation time and reflects the process that created the pick. It is not a description of subsequent edits.

### 3.2 Immutability after posting

Once `picks.posted_at` is set, the source class must not be changed. A posted pick's source is a historical fact, not a mutable attribute.

Before posting, the source class may be corrected if it was set incorrectly due to a system error. This correction must be logged with:
- The original value
- The corrected value
- The reason
- The operator identity
- The timestamp

Corrections without a logged reason are treated as unauthorized mutations and scored as `operator_edited` in analytics.

### 3.3 Operator edits preserve original lineage

When an operator modifies a pick after creation (odds, line, selection, stake), the pick's source class becomes `operator_edited`. The original source class must be preserved in the audit trail:

```
picks.source = 'operator_edited'
picks.metadata.original_source = <original value>
picks.metadata.edited_by = <operator identity>
picks.metadata.edited_at = <timestamp>
picks.metadata.edit_reason = <reason>
```

If `picks.metadata` does not have this structure, the edit is recorded but the original source is `UNKNOWN`. An `UNKNOWN` original source is not treated as `model_generated`.

### 3.4 Historical rows cannot silently change type

Existing rows in the `picks` table must not have their `source` value updated by any migration, backfill, or automated process unless:

1. The row's current `source` is a legacy value not in the UTV2-848 canonical set
2. A deterministic, documented mapping exists from the legacy value to a canonical class
3. The mapping is logged in a migration audit record
4. The mapped value is the least-trusted class consistent with the evidence (e.g., a legacy `direct-api` value with no candidate link maps to `manual`, not `model_generated`)

No mapping may upgrade a row to `model_generated` without a verified `model_registry` link.

---

## 4. Trusted vs Untrusted Source Policy

### 4.1 Row-level source verdicts

| Verdict | Condition |
|---|---|
| PASS | Source class is `model_generated`; `model_or_heuristic_id` is resolvable via UTV2-848 contract; `picks.source` is the canonical value; no operator edit after creation |
| WARN | Source class is `heuristic`, `manual`, or `operator_edited`; pick is usable for operational analytics but excluded from model-edge |
| FAIL | Source class is `shadow`, `replay`, `synthetic`; or source class is `unsupported_market` for CLV/model-edge purposes; or `picks.source` is null |
| UNKNOWN | Source class cannot be determined; `picks.source` is a legacy non-canonical value with no deterministic mapping; or row predates source enforcement |

### 4.2 Source class eligibility matrix (detailed)

| Source class | Trusted ROI | Trusted CLV | Trusted model-edge | Prod-readiness | Syndicate | Notes |
|---|---|---|---|---|---|---|
| `model_generated` | PASS | PASS | PASS | PASS | PASS | Requires all UTV2-848 provenance dimensions also PASS |
| `heuristic` | WARN | WARN | FAIL | WARN | FAIL | Excluded from model-only evaluation |
| `manual` | WARN | WARN | FAIL | WARN | FAIL | Human judgment; cannot be model evidence |
| `shadow` | FAIL | FAIL | FAIL* | FAIL | FAIL | *Shadow-only evaluation plane exists separately |
| `operator_edited` | WARN (original values) | WARN (original values) | FAIL | WARN | FAIL | Original line/odds used if available |
| `unsupported_market` | WARN (no CLV) | FAIL | FAIL | FAIL | FAIL | No closing-line offer; CLV undefined |
| `replay` | FAIL | FAIL | FAIL* | FAIL | FAIL | *Replay research plane exists separately |
| `synthetic` | FAIL | FAIL | FAIL | FAIL | FAIL | Never a production pick |
| `imported_historical` | WARN (UNKNOWN caveat) | WARN (if CLV joinable) | FAIL | FAIL | FAIL | Legacy provenance cannot be verified |
| `UNKNOWN` (unclassified) | FAIL | FAIL | FAIL | FAIL | FAIL | Must be counted; never silently promoted |

### 4.3 Contamination thresholds

A sample is contaminated if it contains rows that do not belong to the sample's intended source class. Contamination is measured as a percentage.

| Contamination level | Label | Action |
|---|---|---|
| 0% | Clean | No caveat required |
| > 0% and ≤ 5% | Minor contamination | Report contamination count; caveat sample |
| > 5% and ≤ 20% | Significant contamination | Exclude sample from model-edge conclusions; report separately |
| > 20% | Major contamination | Entire sample verdict is FAIL; report all reasons |

---

## 5. Runtime Enforcement Semantics

### 5.1 Hard-fail at ingestion boundary

| Condition | Enforcement action |
|---|---|
| `picks.source` null at creation | Reject. Return 422. Pick must not be created without a source class. |
| `picks.source` value not in the canonical set and not a known legacy value | Reject. Return 422. Unknown source values are not accepted at the ingestion boundary. |
| `picks.source = 'shadow'` but `pick_candidates.shadow_mode = false` | Reject. Source class must be consistent with the candidate's shadow flag. |
| `picks.source = 'model_generated'` but no candidate link exists | Reject. A pick claiming model-generated status must have a traceable candidate row. |
| `picks.source = 'synthetic'` entering production queue | Reject at queue-entry boundary. Synthetic picks must never reach `distribution_outbox`. |

### 5.2 Quarantine conditions

| Condition | Enforcement action |
|---|---|
| `picks.source = 'shadow'` and `picks.status` advancing beyond `draft` | Quarantine. Shadow picks must not advance in the lifecycle beyond draft. Log quarantine event. |
| `picks.source = 'operator_edited'` with no `metadata.original_source` recorded | Quarantine for model-edge analytics. Allow pick to proceed operationally. Log missing lineage. |
| `picks.source = 'unsupported_market'` advancing to `qualified` | Quarantine for CLV and model-edge analytics. Allow operational processing. Flag unsupported-market status. |
| `picks.source = 'replay'` reaching `distribution_outbox` | Block distribution. Replay picks must not be posted to channels. Log block event. |
| `picks.source` changes after `picks.posted_at` is set | Quarantine row. Log unauthorized mutation. Flag for operator review. |

### 5.3 Warn-only conditions

| Condition | Enforcement action |
|---|---|
| `picks.source = 'heuristic'` advancing to model-edge analytics | Warn. Exclude from model-edge. Include in heuristic-specific analytics. |
| `picks.source = 'imported_historical'` with missing CLV join | Warn. Score as `no-clv`. Include in historical analytics with caveat. |
| `picks.source = 'manual'` with `stake_units` > 5.0 | Warn. Flag for review. Allow operationally. |
| `picks.source` is a legacy value with a documented mapping | Warn. Apply mapping. Log legacy-source caveat on the row. |

### 5.4 Not every source issue hard-fails

Enforcement is fail-closed at the **ingestion boundary** and quarantine-based for **existing rows**. The principle:

- New picks with invalid source → reject at creation (prevent contamination at source)
- Existing picks with source issues → quarantine from analytics, preserve for operational reporting
- Historical rows with no source → classify as UNKNOWN, count separately, never fabricate

---

## 6. Historical-Row Handling

### 6.1 Scope

All picks created before UTV2-849 enforcement is active. Based on UTV2-847, this includes all 4,183 rows in the 30-day evaluation window and an unknown number of older rows.

### 6.2 Classification approach

Codex must classify each historical row using the following decision tree, in order:

1. If `picks.source` is in the UTV2-848 canonical set → apply the UTV2-849 mapping from §2.4
2. If `picks.source` is a known legacy value with a documented mapping → apply the mapping; label as `legacy-source`
3. If `picks.source` is null → classify as `UNKNOWN`
4. If `picks.source` is any other value → classify as `UNKNOWN`

**The classification is read-only during the UTV2-849 implementation pass.** No `picks.source` values are written. Classification exists only in the report output.

### 6.3 Permitted actions

| Action | Permitted |
|---|---|
| Classify historical rows using the decision tree above | Yes — read-only, report only |
| Count rows per source class | Yes |
| Label rows as `UNKNOWN` when source is indeterminate | Yes |
| Apply the §2.4 mapping from 848 values to 849 classes | Yes |
| Report contamination counts by source class | Yes |

### 6.4 Forbidden actions

| Action | Forbidden |
|---|---|
| Writing any value to `picks.source` during the Codex proof pass | Forbidden — no schema writes in this pass |
| Inferring source class from score values or timestamp patterns | Forbidden — inference is not evidence |
| Upgrading an UNKNOWN row to `model_generated` | Forbidden — fabrication |
| Bulk-reclassifying rows by date range | Forbidden — temporal inference is not provenance |
| Treating legacy `system-scanner` values as `model_generated` without a registry link | Forbidden — scanner ≠ model unless linked |

### 6.5 Historical contamination is a permanent measurement

Historical rows with ambiguous or missing source are a permanent category of measurable contamination. They do not expire. They do not become trusted with time.

The goal is not to clean up history. The goal is to measure the contamination precisely and prevent it from recurring.

---

## 7. Relationship to Provenance Contract (UTV2-848)

Source separation depends on provenance. This dependency is not optional.

| Provenance dimension (UTV2-848) | Source separation dependency |
|---|---|
| `source_type` (from `picks.source`) | This is the primary source classification field. UTV2-849 defines the analytical classes; UTV2-848 defines the enforcement policy for the field itself. |
| `candidate_id` linkage | Required to distinguish `model_generated` from `heuristic` for system-scanner picks. Without a candidate link, a system-scanner pick cannot be classified as `model_generated`. |
| `model_or_heuristic_id` | Required to confirm `model_generated` status. A pick without a resolvable model ID is `heuristic` at best, `UNKNOWN` at worst — never `model_generated`. |
| `shadow_mode` flag | Required to distinguish shadow from production picks. |
| Historical UNKNOWN policy | UTV2-848's no-fabrication rule applies unchanged to source classification. |

**If UTV2-848 is not on `main`, do not dispatch UTV2-849 Codex.**

The enforcement hierarchy is: provenance (848) → source separation (849) → model registry link (850) → market quarantine (851). Each layer depends on the one before it.

---

## 8. Relationship to Truthworthiness Score (UTV2-847)

The `source-separated` dimension in UTV2-847 maps directly to this standard.

### Dimension mapping

| UTV2-847 dimension | UTV2-849 source class requirement |
|---|---|
| `source-separated` PASS | `picks.source` resolves to one of the nine canonical classes; class is unambiguous |
| `source-separated` WARN | `picks.source` is a legacy value with a documented mapping |
| `source-separated` FAIL | `picks.source` is null, unknown, or unmappable |
| `model-attributed` PASS | Source class is `model_generated` AND `model_or_heuristic_id` is resolvable |

### Metrics this standard produces (complement to UTV2-847 dashboard)

| Metric | Definition |
|---|---|
| `source_separated_pct` | % of picks with a canonical source class |
| `model_only_pct` | % of picks classified as `model_generated` |
| `heuristic_contamination_pct` | % of picks in model-edge samples that are actually `heuristic` |
| `manual_contamination_pct` | % of picks in model-edge samples that are actually `manual` |
| `shadow_contamination_pct` | % of picks in production samples that are actually `shadow` |
| `unknown_source_pct` | % of picks with source class `UNKNOWN` |
| `legacy_source_pct` | % of picks with a legacy source value (known but non-canonical) |
| `imported_historical_pct` | % of picks classified as `imported_historical` |

### Effect on UTV2-847 sample verdicts

| Source contamination condition | Effect on 847 verdict |
|---|---|
| Any `shadow` pick in production sample | `source-separated` FAIL for that row |
| Any `model_generated` pick without model registry link | `model-attributed` FAIL |
| Any `heuristic` or `manual` pick in model-edge sample | Row excluded; `manual-source` or `heuristic-source` exclusion reason |
| > 20% UNKNOWN source in any sample | Sample verdict cannot exceed WARN |

---

## 9. Required Operational Reporting

### Output location

```
docs/06_status/proof/source-ledger/
  source-ledger-summary.json
  source-ledger-by-type.csv
  source-ledger-contamination.csv
  source-ledger-exclusions.csv
  README.md
```

### source-ledger-summary.json schema (version 1)

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
  "row_counts": {
    "total_analyzed": 0,
    "source_pass": 0,
    "source_warn": 0,
    "source_fail": 0,
    "source_unknown": 0
  },
  "source_class_counts": {
    "model_generated": 0,
    "heuristic": 0,
    "manual": 0,
    "shadow": 0,
    "operator_edited": 0,
    "unsupported_market": 0,
    "replay": 0,
    "synthetic": 0,
    "imported_historical": 0,
    "unknown": 0,
    "legacy_mapped": 0
  },
  "source_metrics": {
    "source_separated_pct": 0.0,
    "model_only_pct": 0.0,
    "heuristic_contamination_pct": 0.0,
    "manual_contamination_pct": 0.0,
    "shadow_contamination_pct": 0.0,
    "unknown_source_pct": 0.0,
    "legacy_source_pct": 0.0,
    "imported_historical_pct": 0.0
  },
  "contamination_summary": {
    "model_edge_sample_contaminated": true,
    "model_edge_contamination_pct": 0.0,
    "roi_sample_contaminated": false,
    "roi_contamination_pct": 0.0,
    "clv_sample_contaminated": false,
    "clv_contamination_pct": 0.0
  },
  "exclusion_counts": {
    "shadow_mode": 0,
    "replay": 0,
    "synthetic": 0,
    "unsupported_market": 0,
    "manual_source": 0,
    "heuristic_source": 0,
    "operator_edited": 0,
    "unknown_source": 0,
    "legacy_source": 0,
    "imported_historical": 0
  },
  "schema_findings": {
    "picks_source_column_exists": true,
    "picks_source_has_check_constraint": false,
    "distinct_source_values_found": [],
    "legacy_values_detected": [],
    "null_source_count": 0
  }
}
```

### source-ledger-by-type.csv

Columns: `source_class`, `raw_source_value`, `total_rows`, `roi_eligible`, `clv_eligible`, `model_edge_eligible`, `prod_readiness_eligible`, `syndicate_eligible`, `pct_of_total`

One row per distinct combination of (source_class, raw_source_value). Includes the legacy-mapped rows with their original raw values.

### source-ledger-contamination.csv

Columns: `sample_type`, `intended_source_class`, `contaminating_source_class`, `contamination_count`, `contamination_pct`, `severity`

One row per contaminating source class per sample type. Reports what doesn't belong and how much of it exists.

### source-ledger-exclusions.csv

Columns: `pick_id`, `raw_source_value`, `assigned_source_class`, `exclusion_reason`, `excluded_from`, `sport`, `market_key`, `created_at`

One row per (pick_id × exclusion_reason × excluded_from). A single pick excluded from both model-edge and syndicate produces two rows.

### README.md

Must contain:
- Generation timestamp
- Evaluation window
- System verdict with one-sentence explanation
- Source class distribution table (all nine classes + UNKNOWN)
- Contamination summary (model-edge, ROI, CLV)
- Top 3 exclusion reasons by count
- Explicit statement: "Source separation PASS does not mean the model has edge."
- Explicit statement: "Historical UNKNOWN rows are permanently classified as UNKNOWN. They are not reclassified as model_generated."

---

## 10. Codex Implementation Packet

**Dispatch condition:** UTV2-848 must be merged and confirmed on `origin/main`. Verify with `git log --oneline origin/main | head -20` before starting.

**This is a proof/report pass only. No production schema changes. No writes to `picks.source` or any other production column.**

---

```
Issue: UTV2-849 — Source-Separated Pick Ledger Standard
Branch: codex/utv2-849-source-separated-pick-ledger
Depends on: UTV2-848 merged on main — confirm before starting

## Task

Implement a read-only proof/report script that classifies pick sources
and measures source-separation compliance per
docs/06_status/source_separated_pick_ledger_standard.md.

Do not write to any production table.
Do not update picks.source on any row.
Do not fabricate source attribution.
Do not infer source from scores, timestamps, or heuristic patterns.

## Entry point

scripts/source-ledger/run-source-ledger-report.ts

Run as: npx tsx scripts/source-ledger/run-source-ledger-report.ts
Optional flag: --days 30 (evaluation window, default 30)

## Column verification (do this first)

Query picks table:

  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_name = 'picks'
  ORDER BY column_name;

Verify picks.source exists and note its data_type.

Check for a check constraint on picks.source:

  SELECT pg_get_constraintdef(oid)
  FROM pg_constraint
  WHERE conrelid = 'picks'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%source%';

Get all distinct values currently in picks.source:

  SELECT source, COUNT(*) as count
  FROM picks
  GROUP BY source
  ORDER BY count DESC;

Get null count:

  SELECT COUNT(*) as null_source_count FROM picks WHERE source IS NULL;

Also query pick_candidates for shadow_mode and model linkage:

  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'pick_candidates'
  ORDER BY column_name;

  SELECT
    shadow_mode,
    COUNT(*) as count
  FROM pick_candidates
  GROUP BY shadow_mode;

Record all findings in schema_findings section of source-ledger-summary.json.

## Source classification logic

UTV2-848 canonical values → UTV2-849 analytical classes:

  'user-submitted'     → 'manual'
  'manual'             → 'manual'
  'heuristic'          → 'heuristic'
  'operator-edited'    → 'operator_edited'
  'system-scanner'     → classify based on pick_candidates join:
                          - If pick_candidates.pick_id join exists AND
                            pick_candidates.provenance has model_id reference → 'model_generated'
                          - If join exists but no model reference → 'heuristic'
                          - If no join → 'UNKNOWN'
  'board-construction' → same logic as 'system-scanner' above
  null                 → 'UNKNOWN'
  any other value      → 'UNKNOWN' (record raw value in schema_findings.legacy_values_detected)

Additional rules:
  - If pick_candidates.shadow_mode = true for a pick → 'shadow' (overrides base classification)
  - If picks.market is not in market_universe table → 'unsupported_market' (add as secondary flag)
    Note: a 'shadow' pick in an unsupported market is still classified 'shadow' first

For each pick, record:
  - raw_source_value (original picks.source)
  - assigned_source_class (the UTV2-849 class)
  - candidate_join_exists (bool)
  - model_ref_in_provenance (bool or null)

## Sample contamination detection

For each of these intended samples:
  - model_edge_sample: should be model_generated only
  - roi_sample: should be model_generated or heuristic or manual (not shadow/replay/synthetic)
  - clv_sample: should be model_generated only (strict) or heuristic (caveated)

For each sample, count rows that do not belong and compute contamination_pct.

Report in source-ledger-contamination.csv:
  sample_type, intended_source_class, contaminating_source_class, contamination_count,
  contamination_pct, severity

Severity thresholds:
  contamination_pct = 0           → clean
  0 < contamination_pct ≤ 5%     → minor
  5% < contamination_pct ≤ 20%   → significant
  contamination_pct > 20%         → major

## Exclusion logic

A pick is excluded from a sample type if its assigned_source_class is ineligible.
Use the eligibility matrix from §4.2 of the standard.

For each exclusion, produce one row in source-ledger-exclusions.csv per
(pick_id × exclusion_reason × excluded_from).

exclusion_reason values:
  shadow_mode, replay, synthetic, unsupported_market, manual_source,
  heuristic_source, operator_edited, unknown_source, legacy_source,
  imported_historical

excluded_from values:
  model_edge, clv, syndicate, roi, prod_readiness

## Output files — all required

  docs/06_status/proof/source-ledger/source-ledger-summary.json
  docs/06_status/proof/source-ledger/source-ledger-by-type.csv
  docs/06_status/proof/source-ledger/source-ledger-contamination.csv
  docs/06_status/proof/source-ledger/source-ledger-exclusions.csv
  docs/06_status/proof/source-ledger/README.md

JSON schema is in §9 of the standard. Match exactly. schema_version must be 1.

## Implementation rules

1. Read-only. No writes to any table.
2. Use the existing Supabase client from packages/db.
3. Every classified row must be included in source-ledger-by-type.csv.
4. Every excluded row must appear in source-ledger-exclusions.csv (one row per exclusion).
5. UNKNOWN is a classification, not a skip. Count and report all UNKNOWN rows.
6. Shadow picks are reported separately from production picks in all metrics.
7. Record schema_findings.distinct_source_values_found with actual DB values.
8. Record schema_findings.legacy_values_detected for any value not in the
   UTV2-848 canonical set.
9. Record schema_findings.null_source_count.

## Do NOT

- Write to picks.source, pick_candidates, or any production table
- Infer source class from score values, timestamps, or patterns
- Upgrade any UNKNOWN row to model_generated
- Treat system-scanner picks as model_generated without a verified registry link
- Merge shadow and production counts in any metric
- Claim model edge in any output file, log line, or README
- Claim the model is bad
- Require a minimum live sample volume to run — script must complete even if all
  samples are INSUFFICIENT

## Verification steps (all required)

1. pnpm type-check — must pass
2. Write tests at scripts/source-ledger/run-source-ledger-report.test.ts:
   - Verifies all five output files are created
   - Verifies source-ledger-summary.json has schema_version: 1 and all required fields
   - Verifies schema_findings section is present and populated with actual DB values
   - Verifies source-ledger-contamination.csv has a header row
   - Verifies source-ledger-exclusions.csv has a header row
   - Verifies no string "model has edge" appears in any output file
   - Verifies no string "model_generated" is assigned to any row with null provenance
     model reference (requires checking the by-type CSV when model reference is absent)
3. pnpm test:db — must pass
4. pnpm verify — must pass

## Stop conditions

Stop and escalate to operator if:
- picks.source column does not exist
- pick_candidates table does not exist
- market_universe table does not exist
- Any required output file cannot be written
- A column verification query returns an unexpected schema error

Report the stop condition, the query, and the error. Do not work around silently.

## Expected findings (do not treat as authoritative — verify from actual data)

Based on UTV2-847 findings:
  - ~4,183 picks in 30-day window
  - source_type enforcement likely non-existent (no check constraint)
  - model_generated count likely very low or zero (no registry link exists yet)
  - unknown_source_pct may be high if picks.source has null or legacy values
  - shadow_contamination_pct in production samples may be non-zero

Do not pre-populate any metric. Score from real queries only.
```

---

## Appendix: Source class decision tree (reference)

```
picks.source value
│
├─ null → UNKNOWN
│
├─ 'shadow' → shadow
│
├─ 'replay' → replay
│
├─ 'synthetic' → synthetic
│
├─ 'manual' or 'user-submitted' → manual
│
├─ 'heuristic' → heuristic
│
├─ 'operator-edited' → operator_edited
│
├─ 'imported-historical' → imported_historical
│
├─ 'system-scanner' or 'board-construction'
│    │
│    ├─ pick_candidates join (pick_candidates.pick_id = picks.id) exists?
│    │    │
│    │    ├─ NO → UNKNOWN
│    │    │
│    │    └─ YES
│    │         │
│    │         ├─ pick_candidates.shadow_mode = true → shadow
│    │         │
│    │         └─ pick_candidates.provenance has model_id ref resolvable in model_registry?
│    │              │
│    │              ├─ YES → model_generated
│    │              │
│    │              └─ NO → heuristic
│    │
│    └─ (apply shadow override check regardless of above)
│
└─ any other value → UNKNOWN (record in legacy_values_detected)
```

Post-classification override:
- If market not in market_universe: add `unsupported_market` flag (secondary; does not change primary source class)
- If picks.source changed after picks.posted_at: add `unauthorized_mutation` flag (report separately)
