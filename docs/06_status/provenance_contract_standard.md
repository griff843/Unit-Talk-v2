# Provenance Contract Standard

**Issue:** UTV2-848  
**Status:** Governance standard — pre-implementation  
**Author:** Claude — 2026-05-07  
**Scope:** Defines the mandatory provenance contract, trusted/untrusted evidence policy, runtime enforcement semantics, and Codex implementation packet. No runtime behavior changes in this pass.

---

## 1. Purpose

Provenance answers four questions for every production-evaluated pick:

1. **Where did this pick come from?** — Which system, agent, or user submission created it.
2. **Which model/heuristic/source produced it?** — What decision-making process selected this bet.
3. **Which candidate and market universe generated it?** — What scan run, universe row, and feature snapshot existed at decision time.
4. **Is the row trustworthy enough for model-edge evaluation?** — Whether the pick's origin is traceable enough to include in per-model ROI, CLV, and edge analytics.

### Without provenance, the following are invalid:

| Claim type | Why it fails without provenance |
|---|---|
| Model-edge evaluation | Cannot attribute wins/losses to a specific model |
| CLV attribution | Cannot determine which market universe snapshot backed the pick |
| Lifecycle attribution | Cannot confirm a candidate was created before the pick was posted |
| Edge claims | Cannot separate model-generated picks from manual, heuristic, or operator-edited rows |
| Syndicate readiness | Cannot prove the pick originated from a governed, auditable pipeline |

A system that cannot answer "which model/heuristic produced this pick" has no trustworthy model evidence — regardless of sample size, win rate, or CLV appearance.

UTV2-847 established that **100% of the 4,183 analyzed picks fail model-edge evaluation** due to `no_model_attribution`. UTV2-848 makes provenance mandatory so this cannot happen going forward.

---

## 2. Mandatory Provenance Fields

### 2.1 Current schema reality

The `picks` table currently has these provenance-relevant columns:

| Column | Exists | Notes |
|---|---|---|
| `picks.submission_id` | Yes | FK → submissions; present for user-submitted picks only |
| `picks.source` | Yes | Text field; canonical values undefined/unenforced |
| `picks.stake_units` | Yes | UTV2-845 enforcement landed |
| `picks.status` | Yes | Lifecycle state |
| `picks.posted_at` | Yes | Posting timestamp |
| `picks.settled_at` | Yes | Settlement timestamp |
| `picks.scan_run_id` | **No** | Not on picks; lives on `pick_candidates.scan_run_id` |
| `picks.board_run_id` | **No** | Does not exist on picks |
| `picks.model_id` | **No** | Does not exist on picks |
| `picks.candidate_id` | **No** | Relationship is inverted: `pick_candidates.pick_id` → picks |
| `picks.market_universe_id` | **No** | Reachable via `pick_candidates.universe_id` only |
| `picks.feature_snapshot_id` | **No** | Not on picks |
| `picks.score_snapshot_id` | **No** | Not on picks |

The `pick_candidates` table holds the provenance bridge:

| Column | Exists | Notes |
|---|---|---|
| `pick_candidates.pick_id` | Yes | FK → picks; set when candidate converts to a pick |
| `pick_candidates.scan_run_id` | Yes | Which scan run created the candidate |
| `pick_candidates.universe_id` | Yes | FK → market_universe; the market opportunity |
| `pick_candidates.provenance` | Yes | JSONB; flexible provenance metadata |
| `pick_candidates.model_score` | Yes | Score at decision time |
| `pick_candidates.model_tier` | Yes | Tier at decision time |
| `pick_candidates.model_confidence` | Yes | Confidence at decision time |
| `pick_candidates.shadow_mode` | Yes | Whether this was a shadow/non-live evaluation |
| `pick_candidates.is_board_candidate` | Yes | Whether it originated from board construction |

The `model_registry` table holds model attribution:

| Column | Exists | Notes |
|---|---|---|
| `model_registry.id` | Yes | UUID PK |
| `model_registry.model_name` | Yes | Human-readable model name |
| `model_registry.version` | Yes | Version string |
| `model_registry.sport` | Yes | Sport scope |
| `model_registry.market_family` | Yes | Market family scope |
| `model_registry.status` | Yes | champion/challenger/staged/archived |

### 2.2 Canonical provenance field set (required for trusted evaluation)

The following dimensions define complete provenance. Each must be resolvable — either from a direct column or from a join — for a pick to qualify as provenance-PASS.

| Field | Source | Immutable | Granularity | Required for |
|---|---|---|---|---|
| `source_type` | `picks.source` | Yes — set at creation | Row | Trusted ROI, CLV, model-edge, syndicate |
| `submission_id` | `picks.submission_id` | Yes | Row | Trusted ROI (user-submitted picks) |
| `candidate_id` | `pick_candidates.id` via `pick_candidates.pick_id` | Yes | Row | Trusted model-edge, syndicate |
| `market_universe_id` | `pick_candidates.universe_id` | Yes | Row | Trusted CLV, model-edge |
| `scan_run_id` | `pick_candidates.scan_run_id` | Yes | Row | Trusted model-edge |
| `model_or_heuristic_id` | `model_registry.id` via candidate provenance (currently missing — see §2.3) | Yes | Row | Trusted model-edge, syndicate |
| `score_snapshot` | `pick_candidates.model_score` + `model_confidence` + `model_tier` | Yes | Row | Trusted model-edge |
| `board_run_flag` | `pick_candidates.is_board_candidate` | Yes | Row | Trusted board-construction analytics |
| `shadow_mode_flag` | `pick_candidates.shadow_mode` | Yes | Row | Exclusion from live evaluation |
| `stake_units` | `picks.stake_units` | No — can be amended pre-posting | Row | Trusted ROI, model-edge, syndicate |
| `posted_at` | `picks.posted_at` | Yes — set on posting | Row | Trusted ROI, production-readiness |
| `settled_at` | `picks.settled_at` | Yes — set on settlement | Row | Trusted ROI, CLV |
| `runtime_env_id` | `pick_candidates.scan_run_id` + `system_runs` join | Sample | Model-edge, syndicate |
| `provider_attribution` | `market_universe` → `provider_offers` join | Row | Trusted CLV |

### 2.3 The critical gap: model_or_heuristic_id

**The model attribution link does not currently exist in the database.**

The `pick_candidates` table stores `model_score`, `model_tier`, and `model_confidence` — but does not store which specific model ID produced those scores. The `model_registry` table exists but no foreign key or reference ties a candidate's scores to a specific registry entry.

This is the root cause of the `no_model_attribution` blocker that caused 100% of picks to fail in UTV2-847.

**The provenance contract defines this gap as an enforcement target.** UTV2-848 implementation must:
1. Verify whether `pick_candidates.provenance` JSONB contains a model reference.
2. If not, classify all affected rows as UNKNOWN for `model_or_heuristic_id`.
3. Never infer or fabricate a model ID from score values or heuristic patterns.

---

## 3. Trusted vs Untrusted Provenance Policy

### 3.1 Row-level provenance verdicts

| Verdict | Meaning | Condition |
|---|---|---|
| PASS | Fully attributable. Row is eligible for all trusted sample types. | All required provenance fields resolvable; source_type is canonical; candidate_id linkage exists; model_or_heuristic_id resolvable (or row is explicitly manual/heuristic and excluded from model-edge only). |
| WARN | Partial provenance. Row is usable for operational analytics only. | Core linkage exists (candidate_id OR submission_id); source_type present but non-canonical; or one non-critical provenance field missing. |
| FAIL | Insufficient provenance. Row cannot be used for any trusted evaluation. | No candidate_id AND no submission_id; OR source_type null; OR pick_candidates join returns no row for a non-user-submitted pick. |
| UNKNOWN | Historical row where attribution never existed. | Created before provenance enforcement was active; missing fields cannot be recovered without fabrication. |

### 3.2 Exclusion table

Every exclusion must be counted, not dropped. Silent discards are forbidden.

| Exclusion condition | Reason code | Excluded from |
|---|---|---|
| No candidate linkage (`pick_candidates.pick_id` null for non-submission pick) | `no-candidate-link` | model-edge, CLV, syndicate |
| No submission_id AND no candidate_id | `no-provenance` | all trusted samples |
| `model_or_heuristic_id` not resolvable | `no-model-attribution` | model-edge, syndicate |
| `picks.source` null or not in canonical set | `source-ambiguous` | model-edge, syndicate |
| `pick_candidates.shadow_mode = true` | `shadow-mode` | all live-evaluation samples |
| `pick_candidates.universe_id` null | `no-market-universe` | CLV, model-edge |
| `picks.stake_units` null or ≤ 0 | `no-stake` | ROI, model-edge, syndicate |
| Source type is `manual` or `operator-edited` | `manual-source` | model-only edge evaluation |
| Source type is `heuristic` | `heuristic-source` | model-only edge evaluation |
| Row predates provenance enforcement | `historical-unknown` | model-edge, syndicate |
| `pick_candidates.provenance` JSONB missing model ref and no registry link | `model-attribution-jsonb-absent` | model-edge, syndicate |

### 3.3 What is quarantined

Quarantined rows are:
- Excluded from trusted model-edge and syndicate samples
- Counted in `provenance-exclusions.csv` with reason code
- Visible in aggregate totals
- Labeled in provenance-by-source-type output
- Never silently upgraded

Quarantine does **not** mean deletion. The row remains in the database and appears in non-trusted reporting.

### 3.4 What is visible but caveated

| Condition | Caveat label |
|---|---|
| `picks.source` is a legacy non-canonical value | `legacy-source` |
| `pick_candidates.provenance` JSONB has partial model info | `partial-model-attribution` |
| Candidate link exists but `scan_run_id` is null | `scan-run-missing` |
| `model_score` present but no registry link | `score-without-registry` |
| `is_board_candidate` true but no `scan_run_id` | `board-candidate-untraced` |

### 3.5 Non-negotiable rules

1. Every excluded row must appear in `provenance-exclusions.csv`. No silent drops.
2. UNKNOWN is not neutral — it is treated as FAIL for any required provenance dimension.
3. One pick with multiple exclusion reasons produces one CSV row per reason.
4. Historical UNKNOWN rows are counted in a separate `provenance-unknowns.csv`. They are never upgraded to trusted without a traceable evidence chain.
5. Shadow-mode rows (`pick_candidates.shadow_mode = true`) are excluded from all live evaluation but must appear in shadow-specific reporting.
6. Fabrication of any provenance field is forbidden. Missing = UNKNOWN.

---

## 4. Runtime Enforcement Semantics

### 4.1 Hard-fail conditions (pick must not proceed to posting)

| Condition | Enforcement action |
|---|---|
| `picks.source` is null at submission | Reject at ingestion boundary. Return 422. |
| `picks.stake_units` null or ≤ 0 at qualification | Reject qualification. Do not advance status. |
| Candidate row lacks `universe_id` before conversion to pick | Block conversion. Log provenance failure. |
| `picks.source` value not in canonical set at qualification | Block qualification. Log reason. |

### 4.2 Quarantine conditions (pick proceeds but is flagged)

| Condition | Enforcement action |
|---|---|
| `pick_candidates.pick_id` set but `scan_run_id` is null | Allow pick to proceed. Set quarantine flag. Exclude from model-edge evaluation. |
| `picks.source` is canonical but no candidate row exists (user submission) | Allow pick. Mark as `submission-only`. Exclude from model-edge sample. |
| `model_or_heuristic_id` not resolvable from JSONB or registry | Allow pick. Quarantine for model-edge. Include in ROI and CLV samples if other fields PASS. |
| `pick_candidates.shadow_mode = true` | Allow pick. Exclude from live samples. Include in shadow analytics. |

### 4.3 Warn-only conditions

| Condition | Enforcement action |
|---|---|
| `pick_candidates.provenance` JSONB has a model reference not found in `model_registry` | Warn. Score as `partial-model-attribution`. Do not hard-fail. |
| `is_board_candidate = true` but `scan_run_id` is null | Warn. Score as `board-candidate-untraced`. |
| `picks.source` is `manual` or `heuristic` | Warn. Exclude from model-only edge evaluation. Include in ROI sample. |

### 4.4 Not every missing field hard-fails runtime

The enforcement principle is:
- Missing provenance at the **ingestion boundary** → hard fail (prevent contamination at source)
- Missing provenance on **existing rows** → quarantine + count (preserve data, enforce exclusion from analytics)
- Missing provenance in **historical rows** → classify as UNKNOWN, count separately, never upgrade

---

## 5. Historical-Row Policy

### 5.1 Scope

All picks created before the UTV2-848 enforcement boundary is established. Based on UTV2-847 findings, this is the full 4,183-row sample analyzed over the 30-day window.

### 5.2 Permitted treatment

| Condition | Permitted action |
|---|---|
| Row has `submission_id` → user-submitted | Classify as UNKNOWN for model-edge; PASS for ROI if other fields present |
| Row has source = known canonical value | Classify source_type as that canonical value |
| Row has `pick_candidates` link via `pick_candidates.pick_id` | Resolve candidate provenance; score dimensions accordingly |
| Row lacks any linkage | Classify as `historical-unknown`; exclude from all trusted samples |
| Row has JSONB provenance data with model reference | Score as `partial-model-attribution`; do not auto-upgrade to PASS |

### 5.3 Forbidden treatment

| Action | Reason |
|---|---|
| Infer model attribution from score values alone | Scores are not unique to a single model; backfilling creates false evidence |
| Write model_id or attribution to historical rows without a traceable chain | Fabrication — violates invariant 1 |
| Silently upgrade rows from UNKNOWN to trusted | Provenance UNKNOWN means the origin cannot be proven |
| Bulk-reclassify rows based on timestamp ranges | Temporal inference is not provenance |
| Assume all board-construction rows belong to a specific model | Model identity requires a specific, traceable link |

### 5.4 Historical unknowns are a permanent category

Historical UNKNOWN rows remain queryable and visible. They are:
- Counted in `provenance-unknowns.csv`
- Excluded from model-edge samples permanently (unless the actual provenance chain is discovered — not fabricated)
- Included in aggregate ROI counts with caveat label
- Reported separately in the provenance summary

---

## 6. Relationship to Source-Separated Ledgers (UTV2-849)

Provenance is a prerequisite for source separation. A source-separated ledger requires:

1. `picks.source` to be a canonical, enforced value
2. Picks of type `user-submitted` to be separable from `system-scanner`, `board-construction`, `manual`, and `operator-edited` picks
3. The separation to be enforceable at write time, not inferred after the fact

**UTV2-848 defines the contract. UTV2-849 enforces the ledger boundary at write time.**

Until UTV2-849 lands, source separation is a classification exercise — rows are labeled but not prevented from mixing. After UTV2-849, source type is enforced at ingestion and rows are written to the correct ledger partition from creation.

### Canonical source_type values (UTV2-848 definition)

| Value | Meaning |
|---|---|
| `user-submitted` | Came from a user submission via the API |
| `system-scanner` | Generated by the autonomous pick scanner |
| `board-construction` | Generated by board construction logic |
| `manual` | Operator-entered directly; bypasses scanner |
| `heuristic` | Rule-based selection, no model scoring |
| `operator-edited` | Originally another source type, modified by an operator |

Any value not in this set is a `legacy-source`. Legacy sources are visible but caveated.

---

## 7. Relationship to Model Registry (UTV2-850)

The model registry (`model_registry`) exists but is not linked to picks or candidates. UTV2-850 must establish this link.

### What provenance requires of the model registry

| Requirement | Current state |
|---|---|
| `model_registry.id` must be referenceable from a pick or candidate | No FK or JSONB reference exists |
| `model_or_heuristic_id` must resolve to a specific registry row | Currently unresolvable |
| Champion model must be identifiable at the time a pick was created | No timestamp-scoped champion designation |
| Heuristic sources must not masquerade as model-owned rows | `model_tier` field exists but is not registry-linked |

### What model_registry must not allow

- Two simultaneous `champion` entries for the same sport+market_family scope (once UTV2-850 enforces this)
- A pick attributed to a `archived` model without an explicit override flag
- A `model_score` value without a corresponding registry row at the time of scoring

**UTV2-848 does not implement these rules. It defines them as requirements for UTV2-850.**

---

## 8. Relationship to Truthworthiness Score (UTV2-847)

The UTV2-847 `provenance-linked` dimension maps directly to this contract.

| Provenance dimension (UTV2-848) | Truthworthiness dimension (UTV2-847) | Maps to |
|---|---|---|
| source_type present and canonical | `source-separated` | Must be PASS for model-edge |
| candidate_id linkage exists | `provenance-linked` | Must be PASS for model-edge |
| model_or_heuristic_id resolvable | `model-attributed` | Must be PASS for model-edge |
| market_universe_id resolvable | `supported-market` (partial) | Must be PASS for CLV |
| stake_units valid | `stake-valid` | Must be PASS for ROI |

### How provenance PASS/WARN/FAIL maps to truthworthiness sample verdicts

| Provenance verdict | Effect on 847 truthworthiness |
|---|---|
| PASS | Row eligible for all sample types; specific 847 dimensions still scored independently |
| WARN | Row excluded from model-edge and syndicate samples; included in ROI and production-readiness |
| FAIL | Row excluded from all trusted samples; counted in exclusion totals |
| UNKNOWN | Row counted as FAIL for all required dimensions; reported in unknowns separately |

### Provenance metrics to track (complement to 847 dimensions)

| Metric | Query basis |
|---|---|
| % provenance-linked | picks with candidate_id OR submission_id / total |
| % model-attributed | picks with resolvable model_or_heuristic_id / total |
| % source-separated | picks with canonical source_type / total |
| % candidate-linked | picks with pick_candidates join / total |
| % shadow | picks where pick_candidates.shadow_mode = true / total |
| % historical-unknown | picks classified as historical-unknown / total |
| % operator-edited | picks with source_type = 'operator-edited' / total |
| exclusion counts by reason | count per reason code in provenance-exclusions.csv |

---

## 9. Required Operational Reporting

Codex must produce these artifacts during the UTV2-848 implementation pass.

### Output location

```
docs/06_status/proof/provenance/
  provenance-summary.json
  provenance-by-source-type.csv
  provenance-by-sport.csv
  provenance-by-market-family.csv
  provenance-exclusions.csv
  provenance-unknowns.csv
  README.md
```

### provenance-summary.json schema (version 1)

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
    "provenance_pass": 0,
    "provenance_warn": 0,
    "provenance_fail": 0,
    "provenance_unknown": 0
  },
  "provenance_metrics": {
    "provenance_linked_pct": 0.0,
    "model_attributed_pct": 0.0,
    "candidate_linked_pct": 0.0,
    "source_separated_pct": 0.0,
    "shadow_pct": 0.0,
    "historical_unknown_pct": 0.0,
    "operator_edited_pct": 0.0
  },
  "exclusion_counts": {
    "no_candidate_link": 0,
    "no_provenance": 0,
    "no_model_attribution": 0,
    "source_ambiguous": 0,
    "shadow_mode": 0,
    "no_market_universe": 0,
    "no_stake": 0,
    "manual_source": 0,
    "heuristic_source": 0,
    "historical_unknown": 0,
    "model_attribution_jsonb_absent": 0
  },
  "schema_gaps": {
    "model_id_column_exists_on_picks": false,
    "board_run_id_column_exists_on_picks": false,
    "scan_run_id_column_exists_on_picks": false,
    "model_registry_linked_to_candidates": false,
    "provenance_jsonb_has_model_ref_pct": 0.0
  }
}
```

### provenance-by-source-type.csv

Columns: `source_type`, `total_rows`, `provenance_pass`, `provenance_fail`, `provenance_unknown`, `model_attributed_pct`, `candidate_linked_pct`

### provenance-by-sport.csv

Columns: `sport`, `total_rows`, `provenance_pass`, `provenance_fail`, `provenance_unknown`, `source_separated_pct`, `candidate_linked_pct`, `model_attributed_pct`

### provenance-by-market-family.csv

Columns: `market_family`, `total_rows`, `provenance_pass`, `provenance_fail`, `provenance_unknown`, `candidate_linked_pct`

### provenance-exclusions.csv

Columns: `pick_id`, `exclusion_reason`, `source_type`, `sport`, `market_key`, `candidate_id`, `scan_run_id`, `created_at`

One row per (pick_id × exclusion_reason). A pick with three exclusion reasons produces three rows.

### provenance-unknowns.csv

Columns: `pick_id`, `source_type`, `has_submission_id`, `has_candidate_link`, `created_at`, `age_days`

### README.md

Must contain:
- Generation timestamp
- Evaluation window
- System verdict with one-sentence explanation
- Provenance metrics table (all 8 metrics)
- Top 3 exclusion reasons by count
- Count of historical unknowns
- Explicit statement: "Provenance PASS does not mean the model has edge."

---

## 10. PASS / WARN / FAIL System Verdicts

### PASS

All provenance dimensions are resolvable for ≥ 90% of analyzed rows. `source_type` is canonical for all rows. At least one of `candidate_id` or `submission_id` is present for all rows.

A provenance PASS **does not** mean:
- The model has edge
- CLV attribution is complete
- Settlement is valid
- The evidence sample is large enough for statistical conclusions

A provenance PASS means the origin of each pick is traceable enough to attempt evaluation.

### WARN

Core linkage fields are present for ≥ 70% of rows, but one or more of: `source_type` non-canonical for some rows, `model_or_heuristic_id` not resolvable for some rows, or JSONB provenance only partially populated.

WARN rows can be used for operational ROI and production-readiness analytics. Model-edge conclusions require explicit caveat or are excluded.

### FAIL

Any of:
- `source_type` null for > 10% of rows
- No provenance linkage for > 30% of rows
- `model_or_heuristic_id` not resolvable for > 50% of rows

FAIL does not mean the picks are wrong. It means the evidence cannot be trusted for model-edge or syndicate evaluation.

### Critical distinction

A provenance FAIL means:

> "We cannot reliably determine who or what produced this pick, so we cannot evaluate whether the producer has edge."

It does **not** mean the model is bad. It means we cannot know.

---

## 11. Unresolved Schema Questions

These require Codex verification at implementation time. They are noted here so the PM is aware.

| Question | Impact | How to resolve |
|---|---|---|
| Does `pick_candidates.provenance` JSONB contain a model reference field? What is the key name? | Determines whether `model_or_heuristic_id` is resolvable at all for any historical row | Query `SELECT provenance FROM pick_candidates LIMIT 10` |
| Is there a direct FK or join path from `pick_candidates` to `model_registry`? | If yes, model attribution may be partially resolvable; if no, all rows are UNKNOWN for model attribution | Check migration files + FK constraints |
| Does `picks.source` have a database check constraint limiting its values? | If not, legacy values exist freely | `SELECT DISTINCT source FROM picks ORDER BY source` |
| What percentage of `pick_candidates` rows have `pick_id` set? | Determines how many picks can be candidate-linked at all | Aggregate query |
| Does `pick_candidates.scan_run_id` reference `system_runs`? | Determines whether the scan runtime can be joined | Check migration + FK |

---

## 12. Codex Implementation Packet

**Dispatch condition:** Do not dispatch until UTV2-848 governance standard is acknowledged by operator. Verify this document is on `main` before starting.

**This is a proof/report pass only. No production schema changes. No runtime behavior changes.**

---

```
Issue: UTV2-848 — Enforce mandatory provenance contract for all production picks
Branch: codex/utv2-848-provenance-contract-enforcement
Depends on: UTV2-847 merged on main — confirm before starting

## Task

Implement a read-only proof/report script that scores provenance compliance
per docs/06_status/provenance_contract_standard.md.

Do not change any production table. Do not change any runtime behavior.
Do not fabricate any provenance field. Do not write any model_id or attribution
to any historical row.

## Entry point

scripts/provenance/run-provenance-report.ts

Run as: npx tsx scripts/provenance/run-provenance-report.ts
Optional flag: --days 30 (evaluation window, default 30)

## Column verification (do this first, before implementing anything)

Query the actual schema:

  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_name = 'picks'
  ORDER BY column_name;

  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_name = 'pick_candidates'
  ORDER BY column_name;

  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_name = 'model_registry'
  ORDER BY column_name;

Verify which provenance fields exist:
  - picks.source
  - picks.submission_id
  - pick_candidates.pick_id
  - pick_candidates.scan_run_id
  - pick_candidates.universe_id
  - pick_candidates.provenance (JSONB)
  - pick_candidates.shadow_mode
  - pick_candidates.is_board_candidate
  - pick_candidates.model_score
  - pick_candidates.model_confidence
  - pick_candidates.model_tier

Also verify:
  - Does pick_candidates.provenance JSONB contain a model reference key?
    Query: SELECT provenance FROM pick_candidates WHERE provenance IS NOT NULL LIMIT 5
  - What distinct values exist in picks.source?
    Query: SELECT DISTINCT source, COUNT(*) FROM picks GROUP BY source ORDER BY count DESC

Record all findings in schema_gaps section of provenance-summary.json.

## Canonical source_type values

user-submitted, system-scanner, board-construction, manual, heuristic, operator-edited

Any other value is a legacy-source.

## Row classification logic

For each pick in the evaluation window:

1. Determine source_type from picks.source
   - If null → FAIL, reason: source-ambiguous
   - If not in canonical set → WARN, reason: legacy-source

2. Resolve candidate linkage
   - JOIN pick_candidates ON pick_candidates.pick_id = picks.id
   - If join returns a row → candidate_id = pick_candidates.id
   - If no join and source_type = 'user-submitted' → OK (submission-only)
   - If no join and source_type != 'user-submitted' → FAIL, reason: no-candidate-link

3. Resolve model attribution
   - Check pick_candidates.provenance JSONB for a model reference key
   - If found and resolvable to model_registry.id → PASS for model-attributed
   - If found but not in model_registry → WARN, reason: partial-model-attribution
   - If not found → FAIL, reason: no-model-attribution
   - If no candidate row → FAIL, reason: no-model-attribution (cannot resolve)

4. Check shadow mode
   - If pick_candidates.shadow_mode = true → quarantine, reason: shadow-mode

5. Check stake_units
   - If picks.stake_units IS NULL OR picks.stake_units <= 0 → FAIL, reason: no-stake

6. Determine row verdict
   - PASS: source_type canonical, candidate_id present, stake_units valid
   - WARN: source_type canonical, but model_or_heuristic_id not resolvable
   - FAIL: any of the FAIL conditions above
   - UNKNOWN: created_at < enforcement boundary AND no linkage fields at all

## Output files — all required

  docs/06_status/proof/provenance/provenance-summary.json
  docs/06_status/proof/provenance/provenance-by-source-type.csv
  docs/06_status/proof/provenance/provenance-by-sport.csv
  docs/06_status/proof/provenance/provenance-by-market-family.csv
  docs/06_status/proof/provenance/provenance-exclusions.csv
  docs/06_status/proof/provenance/provenance-unknowns.csv
  docs/06_status/proof/provenance/README.md

The JSON schema is defined in §9 of the standard. Match it exactly.
schema_version must be 1.

## Implementation rules

1. Read-only. No writes to any production table.
2. Use the existing Supabase client from packages/db. Do not create a new client.
3. Every excluded row must appear in provenance-exclusions.csv with:
     pick_id, exclusion_reason, source_type, sport, market_key, candidate_id,
     scan_run_id, created_at
4. One pick with multiple exclusion reasons produces one row per reason.
5. UNKNOWN is counted separately in provenance-unknowns.csv — never dropped.
6. Shadow-mode rows appear in shadow counts, not in live evaluation counts.
7. Record schema_gaps in provenance-summary.json based on column verification findings.
8. provenance_summary.json.schema_gaps must accurately reflect what was found,
   including whether model_registry is linked to candidates.

## Do NOT

- Claim model edge in any output file, log line, or README
- Fabricate any model attribution, candidate link, or source_type value
- Write any field to picks, pick_candidates, model_registry, or any other production table
- Silently drop any row from any count
- Infer source_type from context without a real column value
- Upgrade a historical-unknown row to trusted
- Assume pick_candidates.provenance contains a model reference without querying first

## Verification steps (all required)

1. pnpm type-check — must pass
2. Write tests at scripts/provenance/run-provenance-report.test.ts:
   - Verifies all seven output files are created
   - Verifies provenance-summary.json has schema_version: 1 and all required fields
   - Verifies schema_gaps section is present and populated
   - Verifies provenance-exclusions.csv has a header row
   - Verifies provenance-unknowns.csv has a header row
   - Verifies no string "model has edge" appears in any output file
   - Verifies no string "model attribution fabricated" appears in any output file
3. pnpm test:db — must pass
4. pnpm verify — must pass

## Stop conditions

Stop and escalate to operator if:
- picks table does not have a source column (schema regression)
- pick_candidates table does not exist
- model_registry table does not exist
- Any required output file cannot be written
- A column verification query returns an unexpected schema error

Report the stop condition, the query that failed, and the error message.
Do not work around stop conditions silently.

## Expected findings (do not treat as authoritative — verify from actual data)

Based on UTV2-847 findings:
- ~4,183 picks analyzed in the 30-day window
- model_attributed likely 0% (no registry link currently exists)
- candidate_linked percentage unknown — verify from actual join
- source_type population rate unknown — verify from DISTINCT query
- provenance-unknowns count likely high for historical rows

Do not pre-populate any metric. Score from real queries.
```

---

## 13. Contracts That Depend on This Standard

After UTV2-848 implementation is confirmed on `main`, the following contracts become unblocked:

| Issue | Dependency on 848 | What it enforces |
|---|---|---|
| UTV2-849 — Source-Separated Pick Ledger | Requires canonical source_type values from §6 | Writes picks to the correct ledger partition at creation time |
| UTV2-850 — Champion Model Registry | Requires model_or_heuristic_id contract from §2.3 | Establishes the FK link from candidates to model_registry |
| UTV2-851 — Unsupported/Low-Trust Market Quarantine | Requires market_universe_id linkage from §2.2 | Enforces market_universe membership at qualification time |

**Do not begin implementation packets for UTV2-849, UTV2-850, or UTV2-851 until this document is confirmed on `main` and the UTV2-848 Codex pass has run.**
