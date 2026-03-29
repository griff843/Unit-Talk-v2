# Replayable Scoring / Decision Attribution Contract

**Status:** RATIFIED 2026-03-29
**Lane:** claude (design) — codex (implementation: UTV2-145)
**Authority:** Defines the score replay API, input snapshot storage, and deterministic replay function.
**Depends on:** MODEL_REGISTRY_CONTRACT.md (UTV2-136 must land first)

---

## Problem

Promotion decisions are made at submission time but there is no way to replay them. Score inputs (`edge`, `trust`, `readiness`, `uniqueness`, `boardFit`) are written to `pick_promotion_history` but without:
- The weight set used (fixed by UTV2-136 adding `weights` to `PromotionPolicy`)
- The gate inputs at decision time (`isStale`, `withinPostingWindow`, `boardState`, etc.)
- A function to reproduce the exact decision from stored inputs

If the scoring model changes, prior decisions cannot be explained, audited, or compared against a counterfactual.

---

## Input Snapshot

### Extended `pick_promotion_history.metadata`

The `metadata` jsonb field in `pick_promotion_history` currently carries:
- `scoringProfile: string` (added by UTV2-136)
- `policyVersion: string` (added by UTV2-136)

UTV2-145 extends this with the full input snapshot:

```typescript
// Written to pick_promotion_history.metadata at decision time
export interface PromotionDecisionSnapshot {
  // Profile context (from UTV2-136)
  scoringProfile: string;
  policyVersion: string;

  // Score component inputs (the raw 0–100 values before weighting)
  scoreInputs: {
    edge: number;
    trust: number;
    readiness: number;
    uniqueness: number;
    boardFit: number;
  };

  // Gate inputs at decision time
  gateInputs: {
    approvalStatus: string;
    hasRequiredFields: boolean;
    isStale: boolean;
    withinPostingWindow: boolean;
    marketStillValid: boolean;
    riskBlocked: boolean;
    confidenceFloor: number | null;
    pickConfidence: number | null;
  };

  // Board state at decision time
  boardStateAtDecision: {
    currentBoardCount: number;
    sameSportCount: number;
    sameGameCount: number;
    duplicateCount: number;
  };

  // Weights used (from the resolved policy at decision time)
  weightsUsed: {
    edge: number;
    trust: number;
    readiness: number;
    uniqueness: number;
    boardFit: number;
  };

  // Override state if any
  override?: {
    forcePromote?: boolean;
    suppress?: boolean;
    reason?: string;
  };
}
```

This snapshot is complete — given only this snapshot and the policy thresholds (`minimumScore`, `minimumEdge`, `minimumTrust`), the decision can be deterministically reproduced.

---

## Replay Function

Add to `packages/domain/src/promotion.ts`:

```typescript
/**
 * Deterministically reproduces a promotion decision from a stored snapshot.
 *
 * Given the same snapshot and the same policy, this function produces the same
 * BoardPromotionDecision that was recorded at decision time. This is useful for:
 * - Auditing: verify that a stored decision was computed correctly
 * - Counterfactuals: "what would the decision have been under policy X?"
 * - Regression testing: ensure scoring changes do not silently alter past decisions
 *
 * @param snapshot - The PromotionDecisionSnapshot stored in pick_promotion_history.metadata
 * @param policy   - The PromotionPolicy to evaluate against (use the stored policyVersion
 *                   to select the right policy from the registry)
 * @param decidedAt - ISO timestamp for the replay (use the stored decidedAt for exact match)
 */
export function replayPromotion(
  snapshot: PromotionDecisionSnapshot,
  policy: PromotionPolicy,
  decidedAt?: string,
): BoardPromotionDecision {
  const input: BoardPromotionEvaluationInput = {
    target: policy.target,
    pick: {
      // Minimal pick shape — only confidence is used in gate evaluation
      confidence: snapshot.gateInputs.pickConfidence ?? undefined,
    } as CanonicalPick,
    approvalStatus: snapshot.gateInputs.approvalStatus as ApprovalStatus,
    hasRequiredFields: snapshot.gateInputs.hasRequiredFields,
    isStale: snapshot.gateInputs.isStale,
    withinPostingWindow: snapshot.gateInputs.withinPostingWindow,
    marketStillValid: snapshot.gateInputs.marketStillValid,
    riskBlocked: snapshot.gateInputs.riskBlocked,
    scoreInputs: snapshot.scoreInputs,
    minimumScore: policy.minimumScore,
    confidenceFloor: snapshot.gateInputs.confidenceFloor ?? undefined,
    boardCaps: policy.boardCaps,
    boardState: snapshot.boardStateAtDecision,
    override: snapshot.override,
    decidedAt: decidedAt ?? new Date().toISOString(),
    decidedBy: 'replay',
    version: snapshot.policyVersion,
  };

  return evaluatePromotionEligibility(input, policy);
}
```

---

## Write Sites

In `apps/api/src/promotion-service.ts`, the snapshot is assembled immediately before persisting the promotion decision:

```typescript
// In persistPromotionDecisionForPick(), before the history insert:
const snapshot: PromotionDecisionSnapshot = {
  scoringProfile: activeScoringProfile.name,
  policyVersion: policy.version,
  scoreInputs: {
    edge: promotionInput.scoreInputs.edge,
    trust: promotionInput.scoreInputs.trust,
    readiness: promotionInput.scoreInputs.readiness,
    uniqueness: promotionInput.scoreInputs.uniqueness,
    boardFit: promotionInput.scoreInputs.boardFit,
  },
  gateInputs: {
    approvalStatus: promotionInput.approvalStatus,
    hasRequiredFields: promotionInput.hasRequiredFields,
    isStale: promotionInput.isStale,
    withinPostingWindow: promotionInput.withinPostingWindow,
    marketStillValid: promotionInput.marketStillValid,
    riskBlocked: promotionInput.riskBlocked,
    confidenceFloor: policy.confidenceFloor ?? null,
    pickConfidence: pick.confidence ?? null,
  },
  boardStateAtDecision: promotionInput.boardState,
  weightsUsed: policy.weights,
  override: promotionInput.override,
};

// Merge into existing metadata
const metadata = { ...existingMetadata, ...snapshot };
```

---

## Operator API Surface

`evaluateAndPersistPromotion()` should return the `snapshot` alongside the existing `PromotionEvaluationResult`:

```typescript
export interface PromotionEvaluationResult {
  pick: CanonicalPick;
  pickRecord: PickRecord;
  history: PromotionHistoryRecord;
  audit: AuditLogRecord;
  decision: BoardPromotionDecision;
  snapshot: PromotionDecisionSnapshot;   // ← add
}
```

This allows the operator API (`GET /api/operator/snapshot`) to include the score breakdown and gate inputs for recent promotions without a separate query to `pick_promotion_history.metadata`.

---

## Acceptance Criteria (UTV2-145)

- [ ] `PromotionDecisionSnapshot` interface exported from `@unit-talk/contracts`
- [ ] `replayPromotion(snapshot, policy, decidedAt?)` exported from `@unit-talk/domain`
- [ ] Replay function: given same snapshot + policy, produces same `BoardPromotionDecision` as the original
- [ ] `persistPromotionDecisionForPick()` writes full `PromotionDecisionSnapshot` to `pick_promotion_history.metadata`
- [ ] `PromotionEvaluationResult.snapshot` field added
- [ ] `pnpm verify` passes
- [ ] New test: `replayPromotion(snapshot, policy)` returns `qualified: true` given the same inputs that produced a qualified decision
- [ ] New test: `replayPromotion(snapshot, alternatePolicy)` returns `qualified: false` if alternate policy has higher minimumScore threshold (counterfactual test)

---

## Sequencing

UTV2-136 must land first — `replayPromotion()` depends on `policy.weights` being present on `PromotionPolicy`. Without UTV2-136, the replay function would be scoring with implicit (wrong) weights.

After UTV2-145 is implemented: UTV2-135 (correlation-aware scoring) and operator-web score decomposition surface become straightforward additions.
