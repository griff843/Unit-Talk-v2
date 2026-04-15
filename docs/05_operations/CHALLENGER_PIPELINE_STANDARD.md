# Challenger Pipeline Standard

**Status:** RATIFIED 2026-04-15
**Authority:** UTV2-624 — defines challenger presence requirements, promotion and demotion criteria, and review workflow integration per active sport.
**Depends on:** `CHAMPION_INVENTORY_STANDARD.md`, `MODEL_REGISTRY_CONTRACT.md`

---

## Purpose

Elite model programs continuously challenge themselves. A champion without challengers decays. This document defines:

1. What a challenger is and what it must do.
2. Minimum challenger presence per active sport.
3. Hard promotion and demotion criteria (no vague review language).
4. How challenger evaluation integrates with the model registry and review workflow.
5. What happens when no challenger path exists for an active sport.

---

## 1. Challenger Definition

A challenger is a model version in `model_registry` with `status = 'challenger'`, competing against the current `champion` for the same (sport, market_family) slot.

### Challenger requirements

| Requirement | Threshold |
|-------------|-----------|
| Minimum shadow evaluation period | 30 calendar days |
| Minimum prediction count | 100 predictions |
| Minimum market-backed coverage | ≥ 30% of predictions must have `real-edge` or `consensus-edge` source |
| Calibration ceiling | Brier score ≤ 0.28 (champion must be ≤ 0.25 to retain) |

A model that does not meet these requirements cannot be in `challenger` status — it must remain `staged`.

---

## 2. Challenger Presence per Active Sport

### Current state (2026-04-15)

No active sport has a challenger. The `model_registry` table is empty. This is the honest baseline.

| Sport | Has Champion | Has Challenger | Gap Status |
|-------|-------------|----------------|------------|
| NBA | No | No | **Critical gap** — no challenger path defined |
| NFL | No | No | **Critical gap** — no challenger path defined |
| MLB | No | No | **Critical gap** — no challenger path defined |
| NHL | No | No | **Critical gap** — no challenger path defined |

### Requirement

Each active sport (NBA, NFL, MLB, NHL) MUST have at least one of:

1. An active challenger in evaluation against a champion — **or**
2. A staged model on track to become a challenger within 90 days — **or**
3. An explicit gap declaration in this document with a concrete timeline to address it.

Absence without a gap declaration constitutes a model governance failure.

### Gap declarations (current)

All four primary sports lack champions and challengers. The path to addressing this is:

1. Bootstrap a champion model for each sport using the criteria in `CHAMPION_INVENTORY_STANDARD.md` section 5.
2. Upon first champion promotion, immediately stage a challenger to prevent instant decay.
3. Target: at least one sport with champion + challenger within 60 days of first champion bootstrap.

---

## 3. Promotion Criteria (Challenger → Champion)

A challenger is eligible for promotion when ALL of the following are true:

| Criterion | Requirement |
|-----------|-------------|
| Evaluation period | ≥ 30 days of shadow evaluation complete |
| Sample size | ≥ 100 predictions in shadow period |
| Calibration improvement | Challenger Brier score < Champion Brier score by ≥ 0.01 |
| ROI improvement | Challenger flat-bet ROI > Champion flat-bet ROI by ≥ 1.5% |
| CLV improvement | Challenger average CLV% > Champion average CLV% by ≥ 0.5% on shared slates |
| No active safety flags | No circuit-breaker trips in the last 14 days |

Promotion is a write to `model_registry.status = 'champion'` with a simultaneous archival of the prior champion. This must be logged to `experiment_ledger` with `run_type = 'eval'`.

### Promotion authority

Promotions require explicit PM approval (`t1-approved` label on the Linear issue). Claude/Codex cannot self-promote a challenger to champion without a PM-approved Linear issue.

---

## 4. Demotion Criteria (Champion → Archived)

A champion is demoted when ANY of the following are true:

| Criterion | Threshold |
|-----------|-----------|
| Calibration regression | Brier score > 0.30 over last 30 days |
| ROI collapse | Flat-bet ROI < -5% over last 30 days with ≥ 50 predictions |
| CLV collapse | Average CLV% < -1.5% over last 30 days with ≥ 50 predictions |
| Market-backed share collapse | < 20% real-edge or consensus-edge over last 14 days |
| Safety flag | Circuit breaker tripped in scoring pipeline for this slot |

Demotion sets `status = 'archived'` on the champion row. If a challenger exists, it becomes the new champion via the promotion process (not automatic — requires explicit evaluation run).

If demotion leaves a slot with no champion, the slot reverts to `unsupported` state and `CHAMPION_INVENTORY_STANDARD.md` must be updated.

---

## 5. Review Workflow Integration

### Weekly review cadence

Every week (Monday):
1. Pull `model_registry` rows for all active sports with `status IN ('champion', 'challenger')`.
2. Pull `experiment_ledger` rows for the past 7 days.
3. Check calibration, ROI, CLV, and market-backed share against promotion/demotion thresholds.
4. If any threshold is hit: create a Linear issue (kind:modeling, tier appropriate) with the evidence.
5. If no challenger exists for an active sport: create a Linear issue (kind:gap, priority High).

### Monthly review cadence

Every month (first Monday):
1. Run full calibration analysis across all prediction history.
2. Compare champion vs challenger performance across all shared slates.
3. Assess whether any champion is eligible for replacement.
4. Verify `CHAMPION_INVENTORY_STANDARD.md` matches runtime `model_registry` state.

### Failing the review

The weekly/monthly review FAILS (requires a Linear issue before proceeding) if:

- An active sport has no challenger path and no gap declaration with timeline.
- A champion has a demotion condition active for > 14 days without action.
- The champion inventory doc diverges from runtime state.

---

## 6. Model Registry Wiring

### Creating a challenger

```typescript
await repositories.modelRegistry.create({
  modelName: '<name>',
  version: '<semver>',
  sport: '<sport>',
  marketFamily: '<market-family>',
  status: 'staged', // always start as staged, not challenger
  metadata: {
    trainingDataRange: '<iso-from>/<iso-to>',
    experimentLedgerRunId: '<uuid>',
  },
});
```

### Advancing staged → challenger

```typescript
await repositories.modelRegistry.updateStatus(modelId, 'challenger');
// Must also log to experiment_ledger with run_type: 'shadow_comparison'
```

### Checking champion for a slot

```typescript
const champion = await repositories.modelRegistry.findChampion(sport, marketFamily);
// Returns null if slot is unsupported
```

---

## 7. Why This Blocks Elite Status

Elite model programs continuously challenge themselves. Static champions decay — markets evolve, player situations change, and what worked last season may fail this one. A program without an active challenger pipeline is not elite; it is simply running on its last good idea.

The absence of challengers is not a gap in documentation. It is a gap in the program's ability to improve. This document exists to make that gap visible and to give it a concrete path to resolution.
