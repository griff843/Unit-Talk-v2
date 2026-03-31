# Production Readiness Canary Plan

**Status:** Ratified 2026-03-31
**Issue:** UTV2-25 (supersedes SHADOW_VALIDATION_PLAN.md)
**Authority:** Tier 4 — Operational. Cross-references: `migration_cutover_plan.md` (G12), `risk_register.md`.
**Milestone:** UTV2-M8 Cutover Ready

---

## 1. Purpose

This plan replaces the original shadow validation plan (V1-vs-V2 parity comparison). The shadow comparison approach was invalidated by the discovery that V1 contains only synthetic test data ("Sim Durant", "Sim Curry") — not real production picks. Comparing V2 against synthetic V1 data would produce a meaningless green checkmark.

This plan instead proves V2 production readiness through **live canary validation**: real picks flowing through the full pipeline, graded against real game results, with manual and automated correctness verification.

### What cutover risk it reduces

| Risk | Without canary validation | With canary validation |
|------|---------------------------|------------------------|
| Grading produces wrong outcomes | Discovered after picks are settled and posted publicly | Caught during canary period by manual spot-check |
| CLV computation incorrect | Operator stats silently wrong | Verified against closing line data from provider |
| Delivery pipeline drops picks | Picks silently lost | Dead-letter count monitored, 0 tolerance enforced |
| Duplicate Discord posts | User-visible duplicate content | Monitored for 7+ days, atomic claims prevent |
| Operator snapshot lies | Operator makes decisions on wrong data | Spot-checked against direct DB queries |

---

## 2. Canary Period Definition

The canary period is a minimum **7 calendar days** during which V2 is the active system processing real picks, with heightened monitoring and manual verification.

### Entry criteria (before canary starts)

- [ ] `pnpm verify` passes
- [ ] Golden test suite (UTV2-83) passes — all sports, edge cases
- [ ] G1-G11 cutover gates all PASS
- [ ] Operator snapshot accessible and showing healthy state
- [ ] At least one capper actively submitting picks
- [ ] Game results ingesting from SGO feed

### During the canary period

- V2 is the sole system for pick submission, promotion, delivery, and grading
- V1 is frozen (no new picks submitted)
- Operator checks health snapshot at least twice daily
- Any grading run is followed by a manual spot-check of 3 outcomes against real box scores

---

## 3. Validation Surfaces

### 3.1 Grading accuracy

| Aspect | Detail |
|--------|--------|
| What is verified | Every graded pick outcome (win/loss/push) matches the real game result |
| Method | After each `POST /api/grading/run`, spot-check 3 outcomes against the actual box score / stat line from the sports data provider or public source |
| Threshold | 100% accuracy on spot-checked picks. Any incorrect outcome is a **blocking failure**. |
| Evidence | Spot-check log with: pick ID, expected outcome, V2 outcome, source of truth (box score URL or stat line) |

### 3.2 CLV computation

| Aspect | Detail |
|--------|--------|
| What is verified | CLV values are computed and plausible for graded picks with closing line data |
| Method | After settlement, check `settlement_records` for CLV fields (`clvRaw`, `clvPercent`, `beatsClosingLine`). Verify at least 3 picks manually: compare V2's closing line against the actual closing odds from the provider. |
| Threshold | CLV fields populated on >= 80% of graded picks that have closing line data. Manual spot-check shows plausible values (not NaN, not wildly off). |
| Evidence | CLV verification log with pick IDs and values |

### 3.3 Delivery health

| Aspect | Detail |
|--------|--------|
| What is verified | Picks flow through the outbox → worker → Discord without failures |
| Method | Monitor operator snapshot `counts.deadLetterOutbox` and `counts.failedOutbox` daily |
| Threshold | 0 dead-letter rows for the entire canary period. Failed rows acceptable only if retried and eventually delivered. |
| Evidence | Daily snapshot screenshot or JSON export showing counts |

### 3.4 No duplicate deliveries

| Aspect | Detail |
|--------|--------|
| What is verified | Each pick appears exactly once in each target Discord channel |
| Method | Visually inspect Discord channels (canary, best-bets) for duplicates. Cross-reference `distribution_receipts` for duplicate `outbox_id` entries. |
| Threshold | 0 duplicates for the entire canary period |
| Evidence | Receipt query showing unique outbox_id per target |

### 3.5 Operator snapshot truth

| Aspect | Detail |
|--------|--------|
| What is verified | Operator snapshot counts match actual database state |
| Method | At least 3 times during canary period, query DB directly and compare against snapshot JSON |
| Threshold | Counts must match exactly |
| Evidence | Side-by-side comparison (snapshot JSON vs direct query results) |

### 3.6 Stats and leaderboard accuracy

| Aspect | Detail |
|--------|--------|
| What is verified | `/api/operator/stats` and `/api/operator/leaderboard` return correct aggregates |
| Method | After >= 10 settled picks, manually compute expected win rate / ROI for one capper and compare |
| Threshold | Win rate and pick counts must match exactly. ROI within +/-1%. |
| Evidence | Manual computation log |

---

## 4. Success Criteria

The canary period passes when ALL of the following are true:

| Criterion | Threshold |
|-----------|-----------|
| Duration | >= 7 calendar days with >= 3 game days |
| Graded pick volume | >= 30 picks graded during canary period |
| Sport coverage | >= 2 sports with graded picks |
| Grading accuracy | 100% on spot-checked picks (minimum 10 spot-checks) |
| CLV populated | >= 80% of graded picks with closing line data have CLV values |
| Dead-letter count | 0 for entire canary period |
| Duplicate deliveries | 0 for entire canary period |
| Operator snapshot verified | >= 3 spot-checks, all matching |
| Stats accuracy | Manual verification passes for >= 1 capper |
| `pnpm verify` | Passes at canary period end |

---

## 5. Failure Handling

### Blocking failures (stop canary, investigate)

| Condition | Action |
|-----------|--------|
| Any grading outcome incorrect | Stop canary. Fix grading logic. Restart 7-day clock. |
| Dead-letter rows appear | Investigate root cause. If systemic (not transient Discord outage), stop canary. |
| Duplicate Discord posts | Stop canary. Investigate idempotency. Fix before restarting. |
| Operator snapshot counts don't match DB | Investigate. If snapshot is lying about health, fix before restarting. |
| `pnpm verify` fails during canary | Fix. Restart 7-day clock. |

### Non-blocking issues (log and continue)

| Condition | Action |
|-----------|--------|
| CLV missing on some picks (< 20%) | Log as data-availability gap. Continue. |
| Single transient delivery failure that self-recovers | Log. Continue if no dead-letter. |
| Operator snapshot slow but accurate | Log. Continue. |

---

## 6. Evidence Bundle

After canary period, these artifacts must exist:

| Artifact | Format | Location |
|----------|--------|----------|
| Grading spot-check log | Markdown — pick ID, expected outcome, V2 outcome, source | `out/canary-validation/grading_spotcheck_{date}.md` |
| CLV verification log | Markdown — pick IDs, CLV values, manual verification notes | `out/canary-validation/clv_verification_{date}.md` |
| Daily health snapshots | JSON — operator snapshot exports for each canary day | `out/canary-validation/snapshots/` |
| Delivery receipt audit | JSON — `distribution_receipts` for canary period | `out/canary-validation/receipts_{date}.json` |
| Stats verification | Markdown — manual ROI/win rate computation vs API output | `out/canary-validation/stats_verification_{date}.md` |
| Sign-off record | Markdown — reviewer, date, verdict | `out/canary-validation/signoff_{date}.md` |

---

## 7. Roles and Sign-off

| Role | Who | Responsibility |
|------|-----|----------------|
| Canary operator | Claude Code / platform ops | Run grading, collect evidence, spot-check outcomes |
| Parity reviewer | PM (A Griffin) | Review spot-check logs, verify evidence bundle |
| Cutover approver | PM (A Griffin) | Final sign-off; declares cutover gate open |

### Sign-off record must contain

- Canary period dates (start and end)
- Total picks graded
- Sports covered
- Spot-check count and results
- Confirmation of 0 dead-letter, 0 duplicates
- Explicit statement: "Production readiness canary PASSES. Cutover gate G12 is OPEN."

### What blocks sign-off

- Any unresolved blocking failure
- Evidence bundle incomplete
- Canary period shorter than 7 days
- Fewer than 30 graded picks
- Fewer than 2 sports

---

## 8. Relationship to Shadow Validation Plan

`SHADOW_VALIDATION_PLAN.md` is superseded by this document. The shadow plan assumed V1 had real production data suitable for parity comparison. The V1 data extraction audit (UTV2-172) revealed V1 contains only synthetic test data. Cross-system comparison against synthetic data does not prove production correctness.

The shadow comparison scripts (`scripts/shadow-grading-parity.ts`, `scripts/shadow-clv-parity.ts`) are retained as tools — they can be used if real V1 production data becomes available in the future. They are not required for G12.

---

## 9. Exit Criteria

G12 is PASS when:

1. Canary period has run >= 7 days with >= 30 graded picks across >= 2 sports
2. All validation surfaces (section 3) verified
3. All success criteria (section 4) met
4. Evidence bundle (section 6) complete
5. Sign-off record exists with explicit PM approval

After exit: `migration_cutover_plan.md` G12 marked PASS. Cutover sequence (section 5 of cutover plan) may proceed.
