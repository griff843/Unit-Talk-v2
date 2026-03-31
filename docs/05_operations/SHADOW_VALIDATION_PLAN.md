# Shadow Validation Plan

**Status:** SUPERSEDED 2026-03-31 — replaced by `PRODUCTION_READINESS_CANARY_PLAN.md`
**Issue:** UTV2-25
**Authority:** Historical only. V1 data extraction audit (UTV2-172) revealed V1 contains only synthetic test data, invalidating cross-system parity comparison. See `PRODUCTION_READINESS_CANARY_PLAN.md` for the active G12 gate definition.
**Milestone:** UTV2-M8 Cutover Ready

---

## 1. Purpose

Shadow validation is the final pre-cutover gate. It proves that V2 produces correct results on real-world inputs before V1 is frozen.

### What cutover risk it reduces

| Risk | Without shadow validation | With shadow validation |
|------|---------------------------|------------------------|
| Grading produces wrong outcomes | Discovered after picks are settled and posted publicly | Detected before any V2 settlement is authoritative |
| Promotion scoring diverges from expectations | Picks reach wrong channels or are incorrectly blocked | Scoring drift caught in comparison before live routing |
| CLV computation differs from V1 | Operator stats and leaderboards are silently wrong | CLV parity proven on shared game data |
| Settlement chain produces incorrect records | Irreversible — settlement records are append-only | Caught before any settlement is canonical |
| Recap aggregation logic incorrect | Public-facing recaps show wrong numbers | Recap output compared on shared settlement data |

Shadow validation exists to turn the recommended shadow period in `migration_cutover_plan.md` section 4.3 into a concrete, measurable pass/fail gate.

---

## 2. Scope

### In scope

| Surface | Rationale |
|---------|-----------|
| Grading outcome resolution | Core correctness — determines win/loss/push |
| CLV computation | Determines operator stats accuracy |
| Settlement record generation | Append-only, irreversible — must be correct before cutover |
| Promotion scoring (all 3 policies) | Determines which picks reach which Discord channels |
| Stats aggregation (win rate, ROI, avg CLV) | User-facing — leaderboard and /stats command |
| Recap summary generation | Public-facing — posted to Discord |
| Operator snapshot health signals | Operational correctness — operator relies on these for incident detection |
| Discord routing (target resolution) | Verifies picks route to correct channels |

### Out of scope

| Surface | Reason |
|---------|--------|
| Submission intake format differences | V2 intake is already live and validated; V1 intake format is different by design |
| Discord embed formatting | Visual difference, not correctness — V2 embeds are intentionally redesigned |
| Legacy-only features (coaching, live updates) | Not carried to V2 — no parity expected |
| `discord:game-threads` and `discord:strategy-room` | Deferred targets — not implemented in V2, not part of cutover |
| Alert agent line movement detection | Post-cutover hardening (G9 in cutover plan) — V1 has no equivalent |
| Smart Form UI parity | Different frontend by design |
| Member tier model | New in V2 — no V1 equivalent |
| Hedge detection | New in V2 — no V1 equivalent |

---

## 3. Validation Surfaces

### 3.1 Grading parity

| Aspect | Detail |
|--------|--------|
| What is compared | Outcome (win/loss/push) for the same pick on the same game |
| V1 source | V1 grading output (pick ID, outcome, game result) |
| V2 source | `settlement_records` joined to `picks` and `game_results` |
| Comparison basis | Same `participant + event + market_type + line` tuple |
| Fields compared | `result` (win/loss/push), `actual_value` used for resolution |
| Acceptable mismatch | 0% — any outcome disagreement is a blocking mismatch |
| Notes | OVER/UNDER inversion logic must agree. Push threshold (exact line match) must agree. |

### 3.2 CLV computation parity

| Aspect | Detail |
|--------|--------|
| What is compared | CLV values for settled picks that have closing line data |
| V1 source | V1 CLV output per pick |
| V2 source | `settlement_records` fields: `clvRaw`, `clvPercent`, `beatsClosingLine` |
| Comparison basis | Same pick, same closing line offer |
| Fields compared | `clvRaw`, `clvPercent`, `beatsClosingLine` |
| Acceptable mismatch | clvRaw within +/-0.005 (rounding tolerance). `beatsClosingLine` boolean must agree. |
| Notes | Devigging method (proportional) must match. If V1 uses a different devig method, document as a known divergence, not a bug. |

### 3.3 Settlement parity

| Aspect | Detail |
|--------|--------|
| What is compared | Settlement records for the same graded picks |
| V1 source | V1 settlement output |
| V2 source | `settlement_records` table |
| Comparison basis | Same pick ID (or matched by participant + event + market + line + capper) |
| Fields compared | `result`, `source` (must be `grading`), `clvRaw`, profit/loss units |
| Acceptable mismatch | 0% on `result`. CLV within rounding tolerance per section 3.2. |

### 3.4 Promotion scoring parity

| Aspect | Detail |
|--------|--------|
| What is compared | Promotion decision (qualified/not-qualified) and target assignment |
| V1 source | V1 promotion decision per pick (if V1 has equivalent scoring) |
| V2 source | `pick_promotion_history` records |
| Comparison basis | Same pick with same input scores |
| Fields compared | `status` (qualified/not_qualified), `promotion_target`, `composite_score` |
| Acceptable mismatch | V2 promotion model is redesigned. Comparison is informational, not blocking, unless V1 has an exact equivalent. If V1 has no structured promotion scoring, this surface validates V2 internal consistency only (e.g., score >= threshold implies qualified). |
| Notes | V2 has 3 policies (exclusive-insights, trader-insights, best-bets). V1 may have fewer or different policies. Document divergence taxonomy, do not treat policy differences as bugs. |

### 3.5 Stats aggregation parity

| Aspect | Detail |
|--------|--------|
| What is compared | Capper stats (win rate, ROI, avg CLV%) for overlapping time windows |
| V1 source | V1 capper stats output |
| V2 source | `GET /api/operator/stats?capper=X&window=Y` |
| Comparison basis | Same capper, same time window (7d, 30d) |
| Fields compared | `picks`, `wins`, `losses`, `pushes`, `winRate`, `roiPct`, `avgClvPct` |
| Acceptable mismatch | `winRate` within +/-1%. `roiPct` within +/-2%. `avgClvPct` within +/-0.5%. Integer counts (picks, wins, losses, pushes) must match exactly if grading parity passes. |
| Notes | If count mismatches exist with grading parity passing, investigate whether V1 includes picks that V2 excludes (e.g., different status filters). |

### 3.6 Recap summary parity

| Aspect | Detail |
|--------|--------|
| What is compared | Daily recap summary (record, net units, ROI, top play) |
| V1 source | V1 recap output for same day |
| V2 source | `GET /api/operator/recap` or `postSettlementRecapIfPossible()` output |
| Comparison basis | Same recap window (daily, weekly) |
| Fields compared | `record` (W-L-P), `netUnits`, `roiPct`, `topPlay` selection |
| Acceptable mismatch | `netUnits` within +/-0.01 units (rounding). `roiPct` within +/-1%. Record string must match exactly if settlement parity passes. |

### 3.7 Discord routing parity

| Aspect | Detail |
|--------|--------|
| What is compared | Which channel a qualifying pick was routed to |
| V1 source | V1 Discord post channel |
| V2 source | `distribution_outbox.target` and `distribution_receipts.channel` |
| Comparison basis | Same pick that was delivered in both systems |
| Fields compared | Target channel ID |
| Acceptable mismatch | 0% for shared targets (best-bets, canary). New V2-only targets (trader-insights, exclusive-insights) are informational only. |

### 3.8 Operator visibility parity

| Aspect | Detail |
|--------|--------|
| What is compared | Operator snapshot health signals and counts vs actual DB state |
| V1 source | Not applicable — V2 operator surface is new |
| V2 source | `GET /api/operator/snapshot` |
| Comparison basis | V2 internal consistency only — snapshot counts match direct DB queries |
| Fields compared | `counts.pendingOutbox`, `counts.sentOutbox`, `counts.deadLetterOutbox`, pick counts by status |
| Acceptable mismatch | 0% — snapshot must match DB truth |
| Notes | This validates V2 internal correctness, not V1 parity. |

---

## 4. Comparison Model

### 4.1 Shadow run structure

Shadow validation uses **historical overlap comparison**, not dual-write or live-parallel operation. The comparison uses picks that were processed by both V1 and V2 during the period when both systems were concurrently active.

#### Comparison strategy: historical overlap

V2 has been live (ingesting, grading, delivering) while V1 was still operational. The shadow period compares outputs from this overlap window — picks that exist in both systems because both were running.

```
Overlap window (both V1 and V2 active)
    ├── Cappers submit picks → both V1 and V2 receive them
    ├── Both systems grade independently against their own game results
    └── Post-hoc comparison of overlapping graded picks → parity report
```

If the overlap window has already closed (V1 is fully frozen before shadow validation begins), the comparison must use historical data from the period when both systems were active. In this case:

1. Extract V1's grading/settlement output for the overlap period
2. Extract V2's grading/settlement output for the same period
3. Compare post-hoc

If no overlap period exists (V2 was never active concurrently with V1), an alternative approach is required:

- **Replay mode**: Feed V1's historical picks into V2's grading logic (without writing to production tables) and compare V2's computed outcomes against V1's historical outcomes
- This requires a follow-on instrumentation issue (see section 11)

The comparison strategy must be determined before the shadow period begins. This is a prerequisite, not something discovered mid-execution.

#### V1 data extraction prerequisite

Before shadow validation can execute, the following must be established:

| Question | Must be answered before execution |
|----------|-----------------------------------|
| Where is V1's pick data stored? | Database name, table/collection, access method |
| What format are V1 grading outcomes? | Schema, field names, value encoding |
| Does V1 have structured CLV output? | If not, CLV parity is V2-internal only |
| Does V1 have structured promotion scoring? | If not, promotion parity is V2-internal only |
| Does V1 have structured stats aggregation? | If not, stats parity is V2-internal only |
| How are V1 results extracted? | DB query, API call, export script, or manual extraction |
| Is V1 data still accessible? | DB credentials, network access, data retention |

If V1 data is not extractable in structured format for a given surface, that surface downgrades from cross-system parity to V2-internal consistency validation. This must be documented in the evidence bundle as a `DATA_AVAIL` entry, not silently skipped.

### 4.2 Input alignment

For comparison to be valid, both systems must be grading against the same game results. If V1 and V2 use different data sources for game results, this must be documented as a known input divergence before comparison.

| Input | V1 source | V2 source | Alignment method |
|-------|-----------|-----------|------------------|
| Game results | V1's result source (must be identified in V1 data extraction prerequisite) | `game_results` table (populated by `apps/ingestor` from SGO feed) | Verify same `actual_value` for same `event + participant + market_type` |
| Closing lines | V1's closing line source (must be identified) | `provider_offers` table (latest snapshot before event start) | Verify same closing odds for same event |
| Pick data | V1 pick record (must be identified) | `picks` table | Match by capper + event + market + line + selection |

If V1 and V2 use different game result sources (e.g., different odds providers), input alignment cannot be assumed. In this case, game result divergence must be separated from grading logic divergence. The input alignment checker (section 11) must run first, and only picks with matching game result inputs are eligible for grading parity comparison.

### 4.3 Comparison granularity

Comparison is per-pick, per-surface. Each surface produces a row in the comparison table:

```
| pick_match_key | surface | v1_value | v2_value | match | discrepancy_class |
```

### 4.4 Match key

Picks are matched across V1 and V2 by a composite key:

```
match_key = capper + event_name + participant + market_type + line + selection_side
```

If a pick exists in V1 but not V2 (or vice versa), it is classified as a data-availability issue, not a parity failure.

---

## 5. Discrepancy Taxonomy

Every comparison result is classified into exactly one category:

| Category | Code | Definition | Blocks cutover? |
|----------|------|------------|-----------------|
| Match | `MATCH` | V1 and V2 agree within threshold | No |
| Acceptable variance | `ACCEPT_VAR` | Values differ but within defined tolerance (rounding, float precision) | No |
| Warning-level drift | `WARN_DRIFT` | Values differ beyond tolerance but within 2x tolerance; may indicate a systematic bias | No, but must be investigated and explained |
| Blocking mismatch | `BLOCK_MISMATCH` | Values disagree on a zero-tolerance field (outcome, boolean, exact count) | **Yes** |
| Data-availability issue | `DATA_AVAIL` | Pick or game result exists in one system but not the other | No, unless > 10% of picks are affected |
| Timing difference | `TIMING_DIFF` | Same result, different timestamp (e.g., grading ran at different times) | No |
| Known divergence | `KNOWN_DIV` | V2 intentionally differs from V1 (e.g., different devig method, new promotion policy). **Must reference a prior design decision, contract, or ratified doc that explains the divergence.** Post-hoc justifications do not qualify. | No, if documented with prior design reference |
| Test contamination | `CONTAMINATION` | Comparison includes test/proof/synthetic picks | No — exclude from parity calculation |

### Classification rules

- Outcome (win/loss/push): zero tolerance → `BLOCK_MISMATCH` if different
- CLV values: +/-0.005 tolerance → `ACCEPT_VAR` within, `WARN_DRIFT` up to 0.01, `BLOCK_MISMATCH` beyond
- Stats (winRate, ROI): per-surface tolerances defined in section 3
- Channel routing: zero tolerance on shared targets → `BLOCK_MISMATCH` if different
- Counts (picks, wins, losses): zero tolerance if grading parity passes → `BLOCK_MISMATCH`

---

## 6. Acceptance Criteria

### 6.1 Plan-quality criteria (for this document)

This plan is accepted when all of the following are true:

- [ ] Every validation surface in section 3 has a defined comparison basis, fields, and threshold
- [ ] Discrepancy taxonomy covers all possible comparison outcomes
- [ ] Evidence bundle contents are enumerated (section 7)
- [ ] Roles and sign-off authority are defined (section 8)
- [ ] Abort conditions are explicit (section 9)
- [ ] Follow-on execution issues are listed (section 11)
- [ ] Document is referenced from `migration_cutover_plan.md` and `docs_authority_map.md`

### 6.2 Shadow-run success criteria (for future execution)

A shadow run passes when all of the following are true:

| Criterion | Threshold |
|-----------|-----------|
| Grading outcome parity | 100% match on overlapping picks (zero `BLOCK_MISMATCH`) |
| CLV computation parity | >= 95% of picks within `ACCEPT_VAR` tolerance |
| Settlement record parity | 100% result match on overlapping graded picks |
| Stats aggregation parity | All capper stats within defined tolerances |
| Recap summary parity | Record string exact match; net units within tolerance |
| Discord routing parity | 100% match on shared targets |
| Operator snapshot consistency | Snapshot counts match direct DB queries (V2 internal) |
| Data availability | >= 90% of V1 picks have a V2 match (by match key) |
| Warning-level drift | Total `WARN_DRIFT` count < 5% of compared picks |
| Blocking mismatches | 0 unresolved `BLOCK_MISMATCH` entries |
| Duration | Shadow period >= 7 calendar days with >= 3 full game days |
| Sport coverage | At least 2 sports with graded picks during shadow period |
| Minimum pick volume | >= 30 overlapping graded picks compared (across all sports). If seasonal slate is thin, extend the shadow period until this threshold is met. |

---

## 7. Evidence Bundle

After a shadow run, the following artifacts must exist:

| Artifact | Format | Location |
|----------|--------|----------|
| Parity comparison table | CSV or JSON — one row per pick per surface | `out/shadow-validation/comparison_{date}.csv` |
| Mismatch log | Markdown — all `WARN_DRIFT` and `BLOCK_MISMATCH` entries with investigation notes | `out/shadow-validation/mismatch_log_{date}.md` |
| Parity summary | Markdown — aggregate pass/fail per surface, totals by discrepancy class | `out/shadow-validation/parity_summary_{date}.md` |
| Operator snapshot diff | JSON — V2 snapshot counts vs direct DB query counts | `out/shadow-validation/snapshot_consistency_{date}.json` |
| Discord routing receipts | JSON — V2 `distribution_receipts` for shadow period picks | `out/shadow-validation/routing_receipts_{date}.json` |
| Input alignment proof | Markdown — confirmation that V1 and V2 used same game results for overlapping games | `out/shadow-validation/input_alignment_{date}.md` |
| Known divergence register | Markdown — all `KNOWN_DIV` entries with rationale | `out/shadow-validation/known_divergences.md` |
| Sign-off record | Markdown — reviewer name, date, verdict, conditions | `out/shadow-validation/signoff_{date}.md` |

### Evidence retention

Shadow validation evidence is retained in `out/shadow-validation/` indefinitely. It is not deleted after cutover.

---

## 8. Roles and Sign-off

| Role | Who | Responsibility |
|------|-----|----------------|
| Shadow run operator | Claude Code / platform ops | Execute comparison scripts, collect evidence, produce parity report |
| Parity reviewer | PM (A Griffin) | Review mismatch log, investigate `WARN_DRIFT`, decide on `KNOWN_DIV` acceptability |
| Cutover approver | PM (A Griffin) | Final sign-off on shadow validation pass; declares cutover gate open |

### What constitutes sign-off

Sign-off is a written record in `out/shadow-validation/signoff_{date}.md` containing:

- Date of shadow period (start and end)
- Number of picks compared
- Number of games covered
- Sports covered
- Pass/fail per surface (from parity summary)
- List of all `WARN_DRIFT` entries and their resolution
- Confirmation that 0 `BLOCK_MISMATCH` entries remain unresolved
- List of all `KNOWN_DIV` entries accepted
- Explicit statement: "Shadow validation PASSES. Cutover gate is OPEN."

### What blocks sign-off

- Any unresolved `BLOCK_MISMATCH`
- Any `WARN_DRIFT` without an investigation note
- Data availability below 90%
- Shadow period shorter than 7 calendar days
- Fewer than 2 sports with graded picks
- Evidence bundle incomplete (any artifact from section 7 missing)
- Parity reviewer has not reviewed the mismatch log

---

## 9. Abort / Hold Conditions

Shadow validation must fail closed and prevent cutover if any of the following occur during the shadow period:

| Condition | Action |
|-----------|--------|
| V2 `pnpm verify` fails during shadow period | Hold shadow validation. Fix V2. Restart shadow period clock. |
| V2 produces a grading outcome that contradicts the actual game result | Abort. Investigate grading logic. Do not proceed to cutover. |
| > 5 `BLOCK_MISMATCH` entries accumulate in a single day | Hold. Investigate whether a systematic V2 bug exists before continuing. |
| V2 ingestor stops ingesting game results during shadow period | Hold. Restart ingestor and extend shadow period by the downtime duration. |
| V1 is modified during shadow period | Invalidate comparison data from modification date forward. Extend shadow period. |
| Shadow period has zero overlapping graded picks | Incomplete. Extend until sufficient coverage exists. |
| Operator snapshot shows `dead_letter` outbox count > 3 | Warning. Investigate but do not abort unless delivery is systematically failing. |

### Restart rules

If shadow validation is aborted or held:
- The shadow period clock resets from the date of resolution
- Previous comparison data is retained as historical record but does not count toward the 7-day minimum
- A new parity summary is generated for the restarted period

---

## 10. Exit Criteria

Shadow validation is complete when:

1. Shadow period has run for >= 7 calendar days with >= 3 full game days
2. All comparison surfaces in section 3 have been evaluated
3. Parity summary shows pass on all surfaces per section 6.2 thresholds
4. All `BLOCK_MISMATCH` entries are resolved (0 remaining)
5. All `WARN_DRIFT` entries have investigation notes
6. Evidence bundle (section 7) is complete
7. Sign-off record exists with explicit approval from cutover approver
8. `migration_cutover_plan.md` section 4.3 is updated to reference this plan's sign-off

After exit:
- `migration_cutover_plan.md` gate G12 (shadow validation) is marked PASS
- UTV2-25 is marked Done in Linear
- Cutover sequence (section 5 of `migration_cutover_plan.md`) may proceed

---

## 11. Follow-on Execution Issues

The following Linear issues should be created after this plan is ratified. Each is a discrete, executable unit.

### 11.1 Prerequisites

| Title | Tier | Lane | Description |
|-------|------|------|-------------|
| V1 data extraction audit | T1 | claude | Identify V1 data sources for each comparison surface: pick records, grading outcomes, CLV, stats, recaps. Document schema, access method, and extraction path. Determine whether historical overlap exists. **Must complete before any comparison script is written.** |
| Shadow replay mode (if no overlap) | T2 | codex | If V1 is frozen and no overlap period exists: build a replay harness that feeds V1 historical picks through V2's `resolveOutcome()` and `computeAndAttachCLV()` without writing to production tables. Compare computed V2 outcomes against V1 historical outcomes. |

### 11.2 Instrumentation

| Title | Tier | Lane | Description |
|-------|------|------|-------------|
| Shadow comparison script — grading parity | T2 | codex | Script that reads V1 grading output + V2 `settlement_records`, matches by composite key, compares outcomes, outputs CSV with discrepancy classification |
| Shadow comparison script — CLV parity | T2 | codex | Script that compares V1 CLV values against V2 `settlement_records.clvRaw/clvPercent`, applies tolerance, outputs CSV |
| Shadow comparison script — stats parity | T2 | codex | Script that compares V1 capper stats against V2 `/api/operator/stats`, applies tolerances |
| Shadow comparison script — recap parity | T3 | codex | Script that compares V1 recap output against V2 recap summary for same window |
| Shadow input alignment checker | T2 | codex | Script that verifies V1 and V2 used same `actual_value` for overlapping game results |
| Shadow parity report generator | T2 | claude | Aggregates per-surface CSVs into markdown parity summary + mismatch log |

### 11.3 Execution

| Title | Tier | Lane | Description |
|-------|------|------|-------------|
| Run shadow validation period | T1 | claude | Execute the 7+ day shadow period: run comparison scripts daily, collect evidence, produce reports. Requires V1 access for data extraction. |
| Shadow validation sign-off review | T1 | claude | Review parity summary, investigate all drift entries, produce sign-off record or document blockers |

### 11.4 Gate update

| Title | Tier | Lane | Description |
|-------|------|------|-------------|
| Add G12 shadow validation gate to cutover plan | T3 | claude | Update `migration_cutover_plan.md` to add G12 as a formal gate referencing this plan's sign-off |

---

## 12. Authority References

| Purpose | File |
|---------|------|
| Cutover plan | `docs/05_operations/migration_cutover_plan.md` |
| Risk register | `docs/05_operations/risk_register.md` |
| Program status | `docs/06_status/PROGRAM_STATUS.md` |
| Discord routing | `docs/05_operations/discord_routing.md` |
| Docs authority map | `docs/05_operations/docs_authority_map.md` |
| Proof template | `docs/06_status/PROOF_TEMPLATE.md` |

---

## 13. Update Rule

Update this document when:
- A validation surface is added or removed
- Tolerance thresholds are tuned based on shadow run observations
- The comparison model changes (e.g., dual-write instead of post-hoc)
- Roles change

Do not update this document to record shadow run results. Those belong in the evidence bundle (`out/shadow-validation/`).
