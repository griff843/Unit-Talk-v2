# Command Center — Provider-Truth Validation Panel (Requirements + Data Contract)

**Issue:** UTV2-1270 · **Tier:** T2 · **Lane type:** governance (requirements/data-contract only)
**Status:** requirements draft for PM review · **Implementation:** NOT in scope (separate PM-approved lane required)

---

## 1. Purpose

Command Center operators currently cannot tell, at a glance, whether a settled pick's
closing-line evidence is **provider-truth verified** or merely **DB-signal inferred**. Today that
distinction requires ad-hoc SQL or one-off SGO MCP queries. This panel surfaces evidence quality
directly on each pick/evidence row so operators can:

- distinguish provider-truth verified rows from DB-signal-only rows;
- identify stale-line, alt-line, 1H no-close, and overround failures without manual querying;
- separate forward-flow evidence from backfilled historical evidence;
- read a single advisory eligibility signal per row.

This document specifies **what the panel must display** and **the data contract it consumes**. It does
**not** authorize any UI/API implementation, schema change, scoring change, or certification.

### 1.1 Scope guardrails (binding)

- **Requirements only.** No UI, no API, no migration, no runtime code from this lane.
- **No P3 certification.** This panel displays evidence quality; it does not certify edge.
- **Do not mark UTV2-1042 Done.** The 1042 eligibility bucket here is an advisory display field only.
- **No CLV/ROI/edge claims.** The panel reports evidence *quality and provenance*, never profitability.
- **No public Discord changes.**
- **`db_signal_only` rows are advisory only** and must never be presented or counted as
  provider-truth verified.

---

## 2. Operator-facing concept

For each pick/evidence row the panel renders one **verdict chip** plus an expandable evidence detail.
The chip color/state derives from `provider_truth_quality` (PASS / WARN / FAIL). The detail panel
shows provenance, the underlying line/odds triplets, and the specific reason code.

The panel is **read-only and advisory**. It does not mutate evidence, picks, settlement, or any
certification state.

---

## 3. Data buckets

Every row resolves into exactly one **display bucket**. Buckets combine verdict + verification source so
operators can triage by trust level, not just PASS/WARN/FAIL.

| Bucket | Definition | Operator meaning |
|---|---|---|
| **Provider-truth verified PASS** | `verdict=PASS` AND `provider_truth_verified=true` | Highest trust. Provider close confirmed (`mcp_direct` or `poh_verified`). |
| **DB-signal-only PASS (advisory)** | `verdict=PASS` AND `validation_source='db_signal_only'` | DB CLV fields present and internally consistent, but **not** provider-confirmed. Advisory only. |
| **WARN (caveated)** | `verdict=WARN` | Usable with caveat; see `warn_reason`. |
| **FAIL (excluded)** | `verdict=FAIL` | Excluded from any evidence-quality count; see `fail_reason`. |
| **Forward-flow (post-closing-capture)** | `source_provenance='forward_flow'` | Closing odds captured live at settlement, not backfilled. |
| **Backfilled historical** | `source_provenance='backfill'` | Closing odds reconstructed by a historical backfill lane. |

> Buckets 1–4 are mutually exclusive per row (verdict-derived). Buckets 5–6 are an orthogonal
> provenance axis and apply in addition to the verdict bucket.

---

## 4. Data contract (per-row)

All field names, enums, and sources below are **grounded in the existing implementation**
(`apps/api/src/scripts/sgo-provider-truth-audit.ts`, the UTV2-1267 classifier). Net-new fields
not yet produced by any pipeline are explicitly flagged in §6.

### 4.1 Classification fields

| Panel field | Type | Source (table.column / computed) | Values | Status |
|---|---|---|---|---|
| `provider_truth_quality` | enum | classifier `verdict` | `PASS` \| `WARN` \| `FAIL` | implemented |
| `validation_source` | enum | classifier `validation_source` | `mcp_direct` \| `poh_verified` \| `db_signal_only` | implemented (`poh_verified` 0 rows today, see §6) |
| `provider_truth_verified` | boolean | derived: `validation_source ∈ {mcp_direct, poh_verified}` | `true` \| `false` | implemented |
| `reason_code` | enum | classifier `fail_reason` \| `warn_reason` \| `pass_reason` | see §5.3 | implemented |
| `note` | string | classifier `note` | free text, human-readable | implemented |

### 4.2 Line / odds evidence fields

Closing evidence is sourced from `settlement_records.payload.clv.*` (the authoritative CLV payload),
not from `pick_offer_snapshots` (which stores CLV result metadata only).

| Panel field | Type | Source | Notes |
|---|---|---|---|
| `pick_id` | string | `pick_offer_snapshots.pick_id` | row key |
| `db_stored_line` (closing line) | number \| null | `settlement_records.payload.clv.closingLine` | DB-recorded closing line |
| `db_close_odds` | number \| null | `settlement_records.payload.clv.closingOdds` | American odds |
| `entry_odds` (pick odds) | number \| null | `settlement_records.payload.clv.pickOdds` | American odds at submission |
| `provider_key` | string \| null | `settlement_records.payload.clv.providerKey` | e.g. `sgo` |
| `closing_snapshot_at` | ISO-8601 \| null | `settlement_records.payload.clv.closingSnapshotAt` | when close was captured |
| `created_at` | ISO-8601 | `pick_offer_snapshots.created_at` | row creation |

**SGO open/close line vs DB stored line.** The issue asks the panel to show *SGO open line / SGO close
line / DB stored line* and *entry / DB close / SGO close odds*. Today only the **DB stored** triplet
(`db_stored_line`, `db_close_odds`, `entry_odds`) is persisted per row. The **SGO open** and **SGO
close** values are **not yet captured natively** — they require UTV2-1268 (see §6.2). Until then, the
panel must render SGO open/close columns as **"not captured"** rather than blank, to avoid implying a
clean close exists when it does not. The `mcp_direct` reason notes are the only current source of
SGO-side close values, and only for the sampled rows.

### 4.3 Risk / sanity fields

| Panel field | Type | Source | Status |
|---|---|---|---|
| `line_moved` | boolean | derived from reason codes (`LINE_MOVE_STALE`, `LINE_MOVED_*`, `INTERMEDIATE_SNAPSHOT`) | derivable today |
| `alt_line_risk` | boolean | `fail_reason='ALT_LINE'` | implemented (discrete signal) |
| `no_close_market_risk` | enum | `1H_NO_CLOSE` (fail) \| `NO_CLOSE_ONE_SIDE` (warn) \| none | implemented |
| `overround_sanity` | enum | `OVERROUND_INVALID` reason; formula below | **rule net-new** (see §6.3) |
| `source_provenance` | enum | `forward_flow` \| `backfill` (see §4.4) | partial (see §6.4) |
| `utv2_1042_eligibility` | enum | advisory bucket (see §4.5) | **display-only, net-new** |

**Overround sanity formula (grounded).** Overround = `p_over + p_under` where `p` is the
implied probability from each side's odds (`packages/domain/src/probability/devig.ts:108-130`,
proportional devig). A row is overround-sane when both sides are present and the summed implied
probability falls in the expected vig band. The exact pass band and the wiring of `OVERROUND_INVALID`
are **not yet implemented** and must be specified before this column is trusted (§6.3).

### 4.4 Source provenance (`source_provenance`)

| Value | Determination |
|---|---|
| `backfill` | `pick_offer_snapshots.payload.backfill_source` is set (e.g. `UTV2-1262-historical`, `backfill_lane=UTV2-1262`). |
| `forward_flow` | snapshot has **no** backfill marker — closing odds captured live at settlement time. |

Today the audit corpus is explicitly the **backfill** set (`backfill_lane='UTV2-1262'`). Forward-flow
rows exist only after the closing-capture path restored under the closing-odds-capture lane begins
producing live snapshots; the panel must label provenance per row so backfilled and forward-flow
evidence are never conflated in any count.

### 4.5 UTV2-1042 eligibility bucket (advisory display only)

A per-row advisory signal indicating whether the row *would* qualify as provider-truth evidence under
the corrected 1042 definition. **This is a display field only — it does not gate, certify, or advance
UTV2-1042, and `db_signal_only` rows are never "eligible/verified."**

Proposed advisory states (for PM ratification):

| `utv2_1042_eligibility` | Condition |
|---|---|
| `eligible_verified` | `provider_truth_verified=true` AND `verdict=PASS` |
| `advisory_db_signal` | `validation_source='db_signal_only'` AND `verdict=PASS` (advisory, not eligible) |
| `caveated` | `verdict=WARN` |
| `excluded` | `verdict=FAIL` |

---

## 5. Classification rules (verdict + reason codes)

These rules are reproduced verbatim from the implemented classifier so the panel and the pipeline
cannot drift. The panel must **consume** these verdicts, not recompute them.

### 5.1 Phase 1 — DB-signal classification (`classifyRow`)

| Condition | verdict | reason_code | validation_source | provider_truth_verified |
|---|---|---|---|---|
| `closingLine=null AND closingOdds=null` | FAIL | `NULL_BOTH_SIDES` | `db_signal_only` | false |
| `closingOdds=null` (line present) | WARN | `NO_CLOSE_ONE_SIDE` | `db_signal_only` | false |
| `closingLine≠null AND closingOdds≠null` | PASS | `DB_SIGNAL_PASS` | `db_signal_only` | **false** |

**Critical semantic:** `DB_SIGNAL_PASS` is **not** provider-truth verified. DB signals alone cannot
detect `LINE_MOVE_STALE` or `ALT_LINE`; those require provider (SGO) truth. The panel must render
DB-signal PASS distinctly from provider-verified PASS.

### 5.2 Phase 2 — provider override (`applyKnownVerdicts`)

Rows confirmed by direct SGO MCP review are overridden to `validation_source='mcp_direct'`,
`provider_truth_verified=true`, with the provider verdict/reason/note. Only **non-PASS** sampled
verdicts were durably recorded (conservative: sampled PASS rows remain `db_signal_only`).

### 5.3 Reason code vocabulary (exact)

**FAIL** — `LINE_MOVE_STALE`, `ALT_LINE`, `1H_NO_CLOSE`, `NULL_BOTH_SIDES`, `OVERROUND_INVALID`
**WARN** — `ODDS_TIMING_DRIFT`, `NO_CLOSE_ONE_SIDE`, `LINE_MOVED_CORRECT_CLOSE_DRIFT`,
`INTERMEDIATE_SNAPSHOT`, `SETTLEMENT_SOURCE_MISMATCH`, `LINE_MOVED_DB_SIGNAL`
**PASS** — `DB_SIGNAL_PASS`

The panel must display the raw `reason_code` plus the human `note`. Each reason code needs a short
operator-facing label/tooltip (copy to be defined in the UI lane, not here).

---

## 6. Upstream dependencies & known gaps

The panel is a **consumer**. These items must exist (or be explicitly stubbed as "not captured") before
the corresponding column is trustworthy.

### 6.1 UTV2-1267 — classification corpus (available, sampled)
The classifier exists and produced the enums/reason codes above. Coverage is a **31-row sample** with
**13 durable non-PASS verdicts** (6 FAIL + 7 WARN); unsampled rows default to `db_signal_only`.
The panel must show coverage honestly (e.g. "verdict from SGO sample" vs "DB-signal default") and must
not imply full provider coverage. `poh_verified` is defined but currently **0 rows** (requires canonical
`provider_offer_history` re-match).

### 6.2 UTV2-1268 — native SGO close capture (future T1, not done)
SGO Pro exposes `closeBookOdds`, `closeFairOdds`, `closeBookOverUnder`, `openBookOdds`,
`openBookOverUnder` per oddID at query time (`PROVIDER_KNOWLEDGE_BASE.md:341`). Until 1268 captures
these natively, the **SGO open line / SGO close line / SGO close odds** columns have no per-row source
and must render as **"not captured."** 1268 would structurally prevent `LINE_MOVE_STALE`.

### 6.3 Overround sanity rule (net-new)
The `OVERROUND_INVALID` reason and the overround formula exist, but the **decision rule/threshold is not
wired**. `overround_sanity` must remain `unknown`/hidden until a pass band is ratified.

### 6.4 Forward-flow provenance (partial)
`backfill` is detectable today via the payload marker. `forward_flow` depends on the live
closing-capture path emitting snapshots; until forward-flow rows exist, the panel's forward-flow bucket
is expected to be empty (display "0 forward-flow rows yet" rather than implying none qualify).

### 6.5 UTV2-1250 — settled CLV monitor sample (referenced)
Referenced as the settled-sample monitor feeding 1042 re-evaluation; no per-row eligibility metric is
defined in code yet. The `utv2_1042_eligibility` field (§4.5) is the proposed advisory contract and
needs PM ratification.

---

## 7. Non-goals (out of scope for any downstream implementation lane)

- No certification (P3 or otherwise); no UTV2-1042 state change.
- No CLV/ROI/edge/profitability claims anywhere in the panel.
- No write path: the panel never mutates evidence, picks, settlement, or snapshots.
- No threshold/scoring/freshness changes.
- No public Discord surface.

---

## 8. Open decisions for PM

1. **§4.5 eligibility states** — ratify the advisory `utv2_1042_eligibility` vocabulary, or specify an
   alternative. Confirm it stays display-only.
2. **§6.3 overround band** — provide/approve the pass band before `overround_sanity` is shown.
3. **Coverage display** — confirm the panel must visibly mark sampled vs default (DB-signal) verdicts so
   partial SGO coverage is never read as full provider truth.
4. **SGO open/close columns** — confirm rendering "not captured" until UTV2-1268 lands, vs hiding the
   columns entirely.
5. **Sequencing** — confirm the implementation lane (UI/API) waits on UTV2-1268 native-close capture for
   the SGO-side columns, or ships DB-signal + sampled-provider columns first with the SGO columns stubbed.

---

## 9. Acceptance criteria for this requirements lane

- [x] Per-row data contract defined with field names, types, and sources grounded in existing code.
- [x] Verdict/reason-code vocabulary reproduced verbatim from the classifier.
- [x] Six display buckets defined.
- [x] `provider_truth_verified` semantics stated (db_signal_only never verified).
- [x] Forward-flow vs backfill provenance defined.
- [x] UTV2-1042 eligibility specified as advisory display-only.
- [x] Upstream dependencies (UTV2-1267 / 1268 / 1250) and net-new gaps enumerated.
- [x] Guardrails restated; no implementation performed.
