# E2E Pick Pipeline Proof Loop — Final Verdict

**Controlling issue:** UTV2-1359  
**Date:** 2026-06-29  
**Analyst:** Claude Code (claude-sonnet-4-6)

---

## VERDICT: BLOCKED

The repo **can** complete one non-public/internal pick end-to-end through
ingest → generate/model-score → promote → approve/audit → grade → settle → CLV/ROI.

All 13 proof criteria are satisfied by the live system — but not simultaneously
in a single pick for the no-public-delivery path.

One PM-gated action is required to produce a single-pick bundle satisfying all
criteria at once without public delivery:

> **PM Gate UTV2-1361**: Operator approves one current governance-braked
> `system-pick-scanner` pick → routes to `discord:canary` (internal only) →
> pick is graded and settled → CLV and ROI recorded.

---

## Criteria Status (Per PM Directive)

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Data ingested and tied to provider/event/market | ✅ PASS | 780 events, 129,958 game_results ingested today (latest 04:07 UTC) |
| 2 | Pick generated/submitted through intended internal path | ✅ PASS | Pick `a122bcca` — system-pick-scanner, created 11:10 UTC today |
| 3 | Pick received model/domain scoring inputs | ✅ PASS | Promotion scores computed: 33.83/34.54/35.07; edge=46.52, trust=55, Kelly computed |
| 4 | Pick was promoted or marked eligible | ⚠️ PM GATE | Evidence plane pick: not_eligible. Pick `26e4adb9` proves promotion path works (awaiting_approval → qualified → settled) but with public delivery |
| 5 | Pick entered approval/governance flow | ✅ PASS | `validated → awaiting_approval` via governance brake ("governance brake: non-human source system-pick-scanner") |
| 6 | Approval/audit trail exists and is queryable | ✅ PASS | 4 audit_log entries: 3 `promotion.suppressed`, 1 `settlement.evidence_graded` |
| 7 | Pick became evidence-eligible | ✅ PASS | `evidence_ref: game-result:493c640d`, `evidencePlane: true` |
| 8 | Pick was graded | ✅ PASS | `result: loss`, `actualValue: 1`, `gameResultId: 493c640d` |
| 9 | Pick was settled | ✅ PASS | `settlement_records` row `dba9306b`, `status: settled`, `settled_at: 2026-06-29T12:48:09Z` |
| 10 | CLV path populated | ✅ PASS | `clvRaw: 0.034949` (3.49%), `beatsClosingLine: true`, source: `market_universe_provenance` rank=1 verified |
| 11 | ROI/result path populated | ✅ PASS | `profitLossUnits: -1`, `flat_bet_roi: {roi_pct: -100, total_profit: -110, total_wagered: 110}` |
| 12 | No public delivery occurred | ✅ PASS | Pick in `awaiting_approval` — no `queued/posted` transition, `evidencePlane: true` |
| 13 | All IDs/timestamps/lifecycle rows/audit records queryable | ✅ PASS | All IDs recorded in `lifecycle-audit.md` |

---

## What Is Blocked

**Criterion 4** is the single gap. The evidence plane path (criteria 12's no-delivery
requirement) keeps picks in `awaiting_approval` where they receive promotion
evaluation but cannot reach `qualified` status without operator approval. Operator
approval triggers delivery — which conflicts with criterion 12 unless routed to
`discord:canary` (internal channel, not member-facing).

**PM Gate UTV2-1361** resolves this: approve a governance-braked pick, enqueue to
`discord:canary`, wait for grading cycle, verify settlement + CLV + ROI.

---

## Bugs Found (Non-Blocking)

**UTV2-1360**: `pick_offer_snapshots_devig_mode_check` constraint fails on
closing-line snapshot writes — 787 failures logged in `audit_log`. CLV still
resolves via `market_universe_provenance` (rank 1, fail-open). Code fix required:
the settlement service writes a `devig_mode` value not in
`['PAIRED', 'FALLBACK_SINGLE_SIDED']`.

---

## System State Summary (As of 2026-06-29)

| Metric | Value |
|--------|-------|
| Total picks | 52,924 |
| Settled | 7,985 |
| Awaiting approval | 8,527 |
| Evidence plane settlements today | Active (12:48 UTC) |
| Game results | 129,958 |
| Events | 780 (latest 04:07 UTC) |
| Settlements with CLV | 1,259 / 11,127 (11%) |
| Evidence-graded settlements with CLV | 1,463 / 1,463 (100%) |
| ROI (profitLossUnits) populated | 1,463 / 1,463 (100%) |
