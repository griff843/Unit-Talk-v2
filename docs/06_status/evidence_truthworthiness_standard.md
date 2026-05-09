# Evidence Truthworthiness Standard

**Issue:** UTV2-847  
**Status:** Standard — pre-implementation  
**Author:** Claude — 2026-05-07  
**Scope:** Defines scoring semantics, exclusion policy, dashboard contract, and Codex implementation packet. No runtime behavior changes.

---

## 1. Purpose

The evidence truthworthiness score answers one question:

> **Can this row or sample be trusted for model, ROI, CLV, and production-readiness evaluation?**

It does **not** answer:

> "Is the model good?"

These are separate questions. A high truthworthiness score means the evidence is clean enough to evaluate edge. A low score means the evidence is too contaminated or incomplete to draw any conclusion — about the model, ROI, CLV, or anything else.

**Three independent quality planes — never conflate them:**

| Plane | Question | Governed by |
|---|---|---|
| Runtime quality | Is the system running and delivering? | Worker/scheduler/board freshness dimensions |
| Evidence quality | Can the evidence be trusted for evaluation? | This standard (UTV2-847) |
| Model quality | Does the model have real edge? | Post-trustworthy-evidence analysis only |

Model quality conclusions are only valid when evidence quality is PASS. A truthworthiness PASS does not grant a model-has-edge verdict — it grants permission to attempt one.

---

## 2. Score Dimensions

### Master table

| Dimension | Granularity | Model-edge req. | Prod-readiness req. | Syndicate req. |
|---|---|---|---|---|
| worker-freshness | system | no | yes | yes |
| scheduler-freshness | system | no | yes | yes |
| provider-freshness | system | yes (via CLV) | no | yes |
| candidate-materialization-freshness | system | yes | yes | yes |
| board-writer-freshness | system | no | yes | yes |
| stake-valid | row | yes | yes | yes |
| provenance-linked | row | yes | yes | yes |
| CLV-backed | row | yes | no | yes |
| supported-market | row | yes | no | yes |
| settlement-valid | row | yes | no | yes |
| model-attributed | row | yes | no | yes |
| source-separated | row | yes | no | yes |
| queue-latency | row | no | yes | no |
| posting-latency | row | no | yes | no |
| stranded-queue-counts | system | no | yes | no |

### Dimension definitions

#### worker-freshness
| Field | Value |
|---|---|
| Description | Age of the most recent `worker.heartbeat` row in `system_runs`. Proves the outbox-drain daemon is alive. |
| PASS | Last heartbeat < 10 minutes ago |
| WARN | Last heartbeat 10–60 minutes ago |
| FAIL | Last heartbeat > 60 minutes ago, or no rows found |
| Source | `system_runs WHERE run_type = 'worker.heartbeat' ORDER BY created_at DESC LIMIT 1` |

#### scheduler-freshness
| Field | Value |
|---|---|
| Description | Age of the most recent scheduler-initiated run in `system_runs`. Proves the autonomous pick scanner / board construction scheduler is firing. |
| PASS | Last run < 4 hours ago |
| WARN | Last run 4–24 hours ago |
| FAIL | Last run > 24 hours ago, or no rows found |
| Source | `system_runs WHERE run_type LIKE 'scheduler.%' ORDER BY created_at DESC LIMIT 1` |

#### provider-freshness
| Field | Value |
|---|---|
| Description | Age of the most recent `ingested_at` row in `provider_offers`. Required for CLV computation — stale offers mean CLV is uncomputable. |
| PASS | Most recent ingestion < 4 hours ago |
| WARN | 4–24 hours ago |
| FAIL | > 24 hours ago, or no rows found |
| Source | `provider_offers ORDER BY ingested_at DESC LIMIT 1` |

#### candidate-materialization-freshness
| Field | Value |
|---|---|
| Description | Age of the most recently updated row in `pick_candidates`. Proves the board-scan pipeline is materializing fresh candidates for board construction. |
| PASS | Most recent `updated_at` < 6 hours ago |
| WARN | 6–24 hours ago |
| FAIL | > 24 hours ago, or no rows found |
| Source | `pick_candidates ORDER BY updated_at DESC LIMIT 1` |

#### board-writer-freshness
| Field | Value |
|---|---|
| Description | Age of the most recently created board pick in `picks` (identified by a non-null `board_run_id` or equivalent board-construction provenance field). Proves board picks are entering the canonical flow. |
| PASS | Most recent board pick created < 6 hours ago |
| WARN | 6–24 hours ago |
| FAIL | > 24 hours ago, or no board picks found |
| Source | `picks WHERE board_run_id IS NOT NULL ORDER BY created_at DESC LIMIT 1` — Codex must verify the exact column name. |

#### stake-valid
| Field | Value |
|---|---|
| Description | Whether `picks.stake_units` is populated and non-zero. Without a stake unit, ROI and Kelly calculations are meaningless. |
| PASS | `stake_units IS NOT NULL AND stake_units > 0` |
| WARN | n/a |
| FAIL | `stake_units IS NULL OR stake_units <= 0` |
| Source | `picks.stake_units` — depends on UTV2-845 enforcement. |
| Note | This dimension is UNKNOWN (treated as FAIL) for all rows until UTV2-845 lands. |

#### provenance-linked
| Field | Value |
|---|---|
| Description | Whether the pick has a traceable origin. At least one of: `submission_id` (user-submitted), `scan_run_id` (board-scan candidate), `board_run_id` (board construction) must be non-null. |
| PASS | At least one linkage field is non-null |
| WARN | n/a |
| FAIL | All linkage fields are null |
| Source | `picks.submission_id`, `picks.scan_run_id`, `picks.board_run_id` — Codex must verify which columns exist on the `picks` table. |

#### CLV-backed
| Field | Value |
|---|---|
| Description | Whether a settled pick can be joined to a closing-line `provider_offers` row (`is_closing = true`) to compute CLV. Only applies to settled picks — unsettled picks are UNKNOWN. |
| PASS | CLV score present and non-null |
| WARN | Closing-line offer is stale (> 48h from game time) or only partially matched |
| FAIL | No closing-line offer found; CLV uncomputable |
| Source | `provider_offers WHERE is_closing = true`, joined to pick's market |

#### supported-market
| Field | Value |
|---|---|
| Description | Whether the pick's market type exists in `market_universe`. Picks in unsupported markets cannot be CLV-evaluated or included in model-edge conclusions. |
| PASS | Market key found in `market_universe` |
| WARN | n/a |
| FAIL | Market key absent or NULL |
| Source | `market_universe` |

#### settlement-valid
| Field | Value |
|---|---|
| Description | Whether the pick has a clean settlement record. Voided, unresolved, or missing settlement records cannot contribute to any evaluation sample. |
| PASS | `settlement_records` row exists, settlement is complete, no unresolved correction chain |
| WARN | Correction chain exists but correction is complete and resolved |
| FAIL | Not yet settled, voided, or settlement record missing |
| Source | `settlement_records`, `picks.status` |

#### model-attributed
| Field | Value |
|---|---|
| Description | Whether the pick is attributed to a specific model in `model_registry`. Without attribution, per-model edge cannot be evaluated. |
| PASS | Model attribution field non-null and found in `model_registry` |
| WARN | n/a |
| FAIL | Attribution field null or not found in `model_registry` |
| Source | `picks.model_id` (verify column name), `model_registry` |

#### source-separated
| Field | Value |
|---|---|
| Description | Whether the pick's source type is unambiguously one of: `user-submitted`, `system-scanner`, `board-construction`, `manual`. Ambiguous source rows cannot be included in model-only edge evaluation. |
| PASS | Source is one of the four canonical values |
| WARN | Source is present but is a legacy or non-canonical value (e.g., `direct-api`) |
| FAIL | Source is null or not mappable to a canonical value |
| Source | `picks.source` or equivalent provenance field — Codex must verify column name |

#### queue-latency
| Field | Value |
|---|---|
| Description | Time from `picks.created_at` to the corresponding `distribution_outbox` row creation. Measures how quickly qualified picks enter the delivery queue. Only applies to picks with `status = 'queued'` or beyond. |
| PASS | < 30 seconds |
| WARN | 30 seconds – 5 minutes |
| FAIL | > 5 minutes, or no outbox row for a qualified pick |
| Source | `picks.created_at`, `distribution_outbox.created_at` |

#### posting-latency
| Field | Value |
|---|---|
| Description | Time from `distribution_outbox` row creation to confirmed delivery in `distribution_receipts`. Measures end-to-end delivery speed. |
| PASS | < 5 minutes |
| WARN | 5–30 minutes |
| FAIL | > 30 minutes, or no delivery receipt for a sent outbox row |
| Source | `distribution_outbox.created_at`, `distribution_receipts.created_at` |

#### stranded-queue-counts
| Field | Value |
|---|---|
| Description | Count of `distribution_outbox` rows in `pending` status, age > 1 hour, not in dead-letter. Stranded rows are neither processing nor cleanly failed. |
| PASS | 0 stranded rows |
| WARN | 1–5 stranded rows |
| FAIL | > 5 stranded rows |
| Source | `distribution_outbox WHERE status = 'pending' AND created_at < NOW() - INTERVAL '1 hour'` |

---

## 3. Scoring Rubric

### States

```
PASS        = trusted
WARN        = usable but caveated
FAIL        = excluded from trusted evaluation
UNKNOWN     = dimension cannot be evaluated — treated as FAIL for all required dimensions
INSUFFICIENT = sample size too small to evaluate (< 10 rows) — reported but not scored
```

UNKNOWN is not neutral. A missing `stake_units` is UNKNOWN for the `stake-valid` dimension and is treated as FAIL for any sample type that requires it. Unknowns must be counted, not dropped.

### Row-level trust score

Evaluated per pick using row-level dimensions only.

| Row verdict | Rule |
|---|---|
| PASS | All required row-level dimensions for the intended sample type are PASS |
| WARN | All required dimensions are PASS or WARN; at least one is WARN |
| FAIL | Any required dimension is FAIL or UNKNOWN |

The required row-level dimensions depend on which sample type is being evaluated (see §3 contribution table below). A row may be PASS for the ROI sample type and FAIL for the model-edge sample type simultaneously — report both.

### Sample-level trust score

A sample is a set of picks evaluated for a specific purpose (e.g., "settled NBA picks, last 30 days").

| Sample verdict | Rule |
|---|---|
| PASS | = 90% of rows are row-PASS; all required system-level dimensions for this sample type are PASS or WARN |
| WARN | = 70% of rows are row-PASS; at most one required system-level dimension is WARN |
| FAIL | < 70% of rows are row-PASS; or any required system-level dimension is FAIL |
| INSUFFICIENT | Fewer than 10 rows in the sample — report count, do not score |

### System-level trust score

| System verdict | Rule |
|---|---|
| PASS | All system-level dimensions are PASS or WARN |
| WARN | At least one system-level dimension is WARN; none are FAIL |
| FAIL | Any system-level dimension is FAIL |

### Dimension contribution by sample type

| Sample type | Required dimensions (must be PASS) | Acceptable at WARN |
|---|---|---|
| Trusted ROI sample | stake-valid, settlement-valid, provenance-linked | worker-freshness, scheduler-freshness |
| Trusted CLV sample | CLV-backed, settlement-valid, supported-market, provenance-linked | provider-freshness |
| Trusted model-edge sample | model-attributed, source-separated, settlement-valid, supported-market, CLV-backed, provenance-linked, stake-valid | provider-freshness, scheduler-freshness |
| Trusted production-readiness sample | worker-freshness, provenance-linked | scheduler-freshness, provider-freshness, candidate-materialization-freshness, board-writer-freshness, queue-latency, posting-latency, stranded-queue-counts |
| Trusted syndicate-readiness sample | All 15 dimensions must be PASS | None — any WARN blocks syndicate verdict |

---

## 4. Trusted vs Untrusted Evidence Policy

### Excluded from default model-edge analytics

Every exclusion must produce a count and a reason. Silent drops are not permitted.

| Exclusion condition | Reason code | Excluded from |
|---|---|---|
| `stake_units` NULL or = 0 | `no-stake` | ROI, model-edge, syndicate |
| No provenance linkage | `no-provenance` | All trusted samples |
| Model attribution null or not in registry | `no-model-attribution` | Model-edge, syndicate |
| Source type ambiguous or missing | `source-ambiguous` | Model-edge, syndicate |
| Market not in `market_universe` | `unsupported-market` | CLV, model-edge, syndicate |
| No settlement record, or not settled | `not-settled` | ROI, CLV, model-edge |
| CLV score absent or uncomputable | `no-clv` | CLV, model-edge |
| Closing-line offer stale > 48h from game time | `stale-provider-offer` | CLV, model-edge |
| Scheduler last run > 24h (system-level FAIL) | `stale-scheduler` | Model-edge sample verdict |
| Candidate materialization stale > 24h (system-level FAIL) | `stale-candidates` | Production-readiness sample verdict |
| Source is `manual` or `heuristic` | `manual-source` | Model-only edge evaluation |

### Visible but caveated

These rows remain in aggregate counts but are labeled. They are never silently promoted to trusted status.

| Condition | Caveat label |
|---|---|
| `stake_units` present but UTV2-845 not yet confirmed | `stake-unverified` |
| Settlement via resolved correction chain | `corrected-settlement` |
| Provider freshness WARN (4–24h) | `stale-provider-warn` |
| Scheduler freshness WARN (4–24h) | `stale-scheduler-warn` |
| Source is a legacy non-canonical value | `legacy-source` |
| CLV computed from stale closing line | `stale-clv-warn` |
| Queue latency WARN | `queue-latency-warn` |
| Posting latency WARN | `posting-latency-warn` |

### Non-negotiable exclusion rules

1. Do not silently drop rows. Every excluded row must appear in `truthworthiness-exclusions.csv`.
2. One pick can have multiple exclusion reasons — produce one row per reason.
3. UNKNOWN is not a skip — it is counted as FAIL for any required dimension.
4. Manual/heuristic rows are excluded from model-only edge evaluation but remain visible in aggregate ROI and production-readiness reporting.
5. Do not infer or backfill any dimension value. If a value is missing, score it as UNKNOWN.

---

## 5. Dashboard / Report Contract

### Output location

```
docs/06_status/proof/evidence-truthworthiness/
  truthworthiness-summary.json
  truthworthiness-by-dimension.csv
  truthworthiness-by-sport.csv
  truthworthiness-by-market-family.csv
  truthworthiness-by-source-type.csv
  truthworthiness-exclusions.csv
  README.md
```

### truthworthiness-summary.json schema (version 1)

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
  "system_dimensions": {
    "worker_freshness": { "verdict": "PASS | WARN | FAIL | UNKNOWN", "age_minutes": null },
    "scheduler_freshness": { "verdict": "PASS | WARN | FAIL | UNKNOWN", "age_hours": null },
    "provider_freshness": { "verdict": "PASS | WARN | FAIL | UNKNOWN", "age_hours": null },
    "candidate_materialization_freshness": { "verdict": "PASS | WARN | FAIL | UNKNOWN", "age_hours": null },
    "board_writer_freshness": { "verdict": "PASS | WARN | FAIL | UNKNOWN", "age_hours": null },
    "stranded_queue_counts": { "verdict": "PASS | WARN | FAIL", "count": 0 }
  },
  "row_counts": {
    "total_analyzed": 0,
    "trusted_pass": 0,
    "trusted_warn": 0,
    "untrusted_fail": 0,
    "unknown": 0
  },
  "dimension_pass_rates": {
    "stake_valid_pct": 0.0,
    "provenance_linked_pct": 0.0,
    "clv_backed_pct": 0.0,
    "supported_market_pct": 0.0,
    "settlement_valid_pct": 0.0,
    "model_attributed_pct": 0.0,
    "source_separated_pct": 0.0
  },
  "latency": {
    "avg_queue_latency_seconds": null,
    "avg_posting_latency_seconds": null
  },
  "exclusion_counts": {
    "no_stake": 0,
    "no_provenance": 0,
    "no_model_attribution": 0,
    "source_ambiguous": 0,
    "unsupported_market": 0,
    "not_settled": 0,
    "no_clv": 0,
    "stale_provider_offer": 0,
    "stale_scheduler": 0,
    "stale_candidates": 0,
    "manual_source": 0
  },
  "sample_verdicts": {
    "trusted_roi_sample": "PASS | WARN | FAIL | INSUFFICIENT",
    "trusted_clv_sample": "PASS | WARN | FAIL | INSUFFICIENT",
    "trusted_model_edge_sample": "PASS | WARN | FAIL | INSUFFICIENT",
    "trusted_production_readiness_sample": "PASS | WARN | FAIL | INSUFFICIENT",
    "trusted_syndicate_readiness_sample": "PASS | WARN | FAIL | INSUFFICIENT"
  }
}
```

### truthworthiness-by-dimension.csv

Columns: `dimension`, `granularity`, `verdict`, `pass_count`, `warn_count`, `fail_count`, `unknown_count`, `pass_pct`

### truthworthiness-by-sport.csv

Columns: `sport`, `total_rows`, `trusted_pass`, `untrusted_fail`, `stake_valid_pct`, `provenance_linked_pct`, `clv_backed_pct`, `settlement_valid_pct`, `model_attributed_pct`

### truthworthiness-by-market-family.csv

Columns: `market_family`, `total_rows`, `trusted_pass`, `supported_market_pct`, `clv_backed_pct`, `settlement_valid_pct`

### truthworthiness-by-source-type.csv

Columns: `source_type`, `total_rows`, `trusted_pass`, `model_attributed_pct`, `source_separated_pct`

### truthworthiness-exclusions.csv

Columns: `pick_id`, `exclusion_reason`, `dimension`, `dimension_value`, `sport`, `market_key`, `source_type`, `created_at`

One row per (pick_id × exclusion_reason). If a single pick triggers three exclusion conditions, it produces three rows.

### README.md

The README must contain:
- Generation timestamp
- Evaluation window
- System verdict (PASS / WARN / FAIL) with one-sentence explanation
- Sample verdict table (all five sample types)
- Top 3 exclusion reasons by count
- Explicit statement: "A truthworthiness PASS does not mean the model has edge."

---

## 6. PASS / WARN / FAIL Verdicts

### PASS

Evidence quality is sufficient to evaluate production-runtime health and early model signal.

All system-level dimensions are PASS or WARN. Row-level pass rates meet the 90% threshold for at least one of: ROI, CLV, or model-edge sample types.

### WARN

System is producing evidence, but one or more required dimensions remain too weak for model-edge or syndicate conclusions.

At least one system-level dimension is WARN, or row-level pass rates are 70–89% for required dimensions. Use for production-readiness evaluation; caveat all model-edge conclusions explicitly.

### FAIL

Evidence is too contaminated or stale to support model, ROI, CLV, or production-readiness claims.

Any system-level dimension is FAIL, or row-level pass rates fall below 70% for any required dimension across all five sample types.

### Critical distinction — repeated explicitly

A truthworthiness PASS does **not** mean the model has edge.

It means the evidence is clean enough to attempt an edge evaluation. Model quality is a separate analysis that begins only after a PASS verdict is confirmed.

---

## 7. Relationship to Upcoming Issues

| Issue | Role relative to 847 | Direction |
|---|---|---|
| UTV2-845 | 847 depends on 845 | 845 enforces canonical `stake_units` population — the `stake-valid` dimension is UNKNOWN until 845 lands |
| UTV2-848 | 848 uses 847 as policy base | Mandatory provenance contract enforces `provenance-linked` at the ingestion boundary |
| UTV2-849 | 849 uses 847 as policy base | Source-separated ledgers enforce `source-separated` at the write boundary |
| UTV2-850 | 850 uses 847 as policy base | Champion model registry enforces `model-attributed` |
| UTV2-851 | 851 uses 847 as policy base | Unsupported-market quarantine enforces `supported-market` before picks enter canonical flow |
| UTV2-852 | 852 uses 847 as policy base | Schema drift health checks surface dimension failures caused by PostgREST cache drift (as seen in UTV2-846) |

### Sequencing

1. **UTV2-845 lands.** The `stake-valid` dimension becomes evaluable. This is a hard dependency for the Codex implementation of 847.
2. **UTV2-847 standard is written now** (this document). Codex implementation is held until 845 is confirmed on `main`.
3. **Codex implements 847** after 845 merges. Output artifacts are proof-only — no runtime changes.
4. **848 / 849 / 850 / 851** each enforce a specific 847 dimension at the ingestion/write boundary. Over time, these reduce the exclusion counts that 847 reports.
5. **UTV2-852** adds schema drift detection so PostgREST cache failures (the UTV2-846 pattern) are caught before they produce UNKNOWN dimension values.

### Why 845 must land first

The Codex implementation will query `picks.stake_units` directly. If 845 has not landed, the field will be null or unreliably populated for all rows and the stake-valid dimension will score as UNKNOWN across the board. Implementing 847 before 845 produces a useless report.

---

## 8. Codex Implementation Packet

**Dispatch condition:** Do not dispatch until UTV2-845 is merged and confirmed on `origin/main`. Verify with `git log --oneline origin/main | head -20` before starting.

---

```
Issue: UTV2-847 — Build evidence truthworthiness scoring and integrity dashboard
Branch: codex/utv2-847-evidence-truthworthiness-dashboard
Depends on: UTV2-845 merged on main — confirm before starting

## Task

Implement a read-only proof/report script that scores evidence truthworthiness
per docs/06_status/evidence_truthworthiness_standard.md.

Do not change any production table. Do not change any runtime behavior.

## Entry point

scripts/evidence-truthworthiness/run-scoring.ts

Run as: npx tsx scripts/evidence-truthworthiness/run-scoring.ts
Optional flag: --days 30 (evaluation window, default 30)

## Column name verification (do this first)

Before implementing, query the actual schema:

  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'picks' ORDER BY column_name;

Verify which of these exist:
  - picks.stake_units
  - picks.model_id (or equivalent model attribution field)
  - picks.source (or equivalent source type field)
  - picks.submission_id
  - picks.scan_run_id
  - picks.board_run_id

If any expected column is missing, stop and report — do not infer or rename.
If picks.stake_units does not exist, UTV2-845 has not landed. Stop.

## Output files — all required

  docs/06_status/proof/evidence-truthworthiness/truthworthiness-summary.json
  docs/06_status/proof/evidence-truthworthiness/truthworthiness-by-dimension.csv
  docs/06_status/proof/evidence-truthworthiness/truthworthiness-by-sport.csv
  docs/06_status/proof/evidence-truthworthiness/truthworthiness-by-market-family.csv
  docs/06_status/proof/evidence-truthworthiness/truthworthiness-by-source-type.csv
  docs/06_status/proof/evidence-truthworthiness/truthworthiness-exclusions.csv
  docs/06_status/proof/evidence-truthworthiness/README.md

The JSON schema is defined in §5 of the standard. Match it exactly (field names,
types, and null values). schema_version must be 1.

## Implementation rules

1. Read-only. No writes to any production table.
2. Use the existing Supabase client from packages/db. Do not create a new client.
3. Evaluate all 15 dimensions per the standard. Do not skip any.
4. System-level dimensions are evaluated once per script run.
5. Row-level dimensions are evaluated per pick in the evaluation window.
6. Every excluded row must appear in truthworthiness-exclusions.csv with:
     pick_id, exclusion_reason, dimension, dimension_value, sport, market_key,
     source_type, created_at
7. One pick with multiple exclusion reasons produces one row per reason.
8. UNKNOWN is treated as FAIL for any required dimension — do not skip or omit.
9. Insufficient samples (< 10 rows) set the sample verdict to INSUFFICIENT, not FAIL.
10. truthworthiness-summary.json must include all five sample_verdicts fields.

## Do NOT

- Claim model edge in any output file, log line, comment, or README
- Claim the model is bad
- Silently drop any row from any count
- Infer or backfill stake_units
- Fabricate provenance linkage
- Change picks.status, distribution_outbox, settlement_records, or any production table
- Require a minimum live sample volume to run — the script must complete even if
  all samples are INSUFFICIENT

## Verification steps (all required)

1. pnpm type-check — must pass
2. Write tests at scripts/evidence-truthworthiness/run-scoring.test.ts:
   - Verifies all six output files are created
   - Verifies truthworthiness-summary.json has schema_version: 1 and all required fields
   - Verifies truthworthiness-exclusions.csv has a header row
   - Verifies no string "model has edge" appears in any output file
   - Verifies no string "model is bad" appears in any output file
3. pnpm verify — must pass

## Stop conditions

Stop and escalate to operator if:
- picks.stake_units column does not exist (UTV2-845 not landed)
- system_runs table does not exist
- provider_offers table is missing
- Any required output file cannot be written
- A dimension query returns an unexpected schema error

Report the stop condition, the query that failed, and the error message.
Do not work around stop conditions silently.
```

---

## Unresolved policy questions

These require PM or operator decision before the Codex implementation can finalize the following:

| Question | Impact |
|---|---|
| Exact column name for model attribution on `picks` | Affects `model-attributed` dimension scoring |
| Exact column name for source type on `picks` | Affects `source-separated` dimension scoring |
| Which provenance linkage columns exist on `picks` | Affects `provenance-linked` dimension scoring |
| Minimum evaluation window (default 30 days — is this right?) | Affects sample size and INSUFFICIENT thresholds |
| Whether `board_run_id` exists on `picks` directly or only on `pick_candidates` | Affects `board-writer-freshness` and `provenance-linked` queries |

These are schema-verification questions Codex will resolve at implementation time per the column-verification step above. They are noted here so the PM is aware they exist.
