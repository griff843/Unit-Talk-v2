# Model Registry Contract

**Status:** RATIFIED 2026-03-29
**Lane:** claude (design) — codex (implementation: UTV2-136)
**Authority:** Defines the `ScoringProfile` type, named profile registry, and the score weights bug fix in `@unit-talk/contracts` + `@unit-talk/domain`.

---

## Problem

Two distinct issues tracked in UTV2-136:

### Issue 1: Score weights are hardcoded to best-bets regardless of policy (BUG)

`packages/domain/src/promotion.ts:150–160` (`calculateScore`) always uses `bestBetsScoreWeights`:

```typescript
function calculateScore(input: BoardPromotionEvaluationInput): PromotionScoreBreakdown {
  return {
    edge: normalizeScore(input.scoreInputs.edge) * bestBetsScoreWeights.edge,   // ← hardcoded
    ...
```

`buildDecision` also hardcodes `weights: bestBetsScoreWeights` in the explanation (line 193).

This means trader-insights and exclusive-insights picks are evaluated with the wrong weight distribution. **This is a scoring accuracy bug.**

### Issue 2: No named profile mechanism

Scoring weights are implicit constants, not configurable. There is no way to run a variant weight set, compare results between cohorts, or roll back a weight change without a code deploy. `PromotionPolicy` has no `weights` field — weights live separately as standalone constants.

---

## Design

### Step 1: Add `weights` to `PromotionPolicy`

In `packages/contracts/src/promotion.ts`, add `weights: PromotionScoreWeights` to the `PromotionPolicy` interface:

```typescript
export interface PromotionPolicy {
  target: PromotionTarget;
  minimumScore: number;
  minimumEdge: number;
  minimumTrust: number;
  confidenceFloor?: number | undefined;
  boardCaps: PromotionBoardCaps;
  weights: PromotionScoreWeights;   // ← add
  version: string;
}
```

Update the three policy constants to include explicit weights:

```typescript
export const bestBetsPromotionPolicy: PromotionPolicy = {
  target: 'best-bets',
  minimumScore: 70,
  minimumEdge: 0,
  minimumTrust: 0,
  confidenceFloor: 0.6,
  boardCaps: { perSlate: 15, perSport: 10, perGame: 2 },
  weights: bestBetsScoreWeights,   // { edge: 0.35, trust: 0.25, readiness: 0.20, uniqueness: 0.10, boardFit: 0.10 }
  version: 'best-bets-v2',
};

export const traderInsightsPromotionPolicy: PromotionPolicy = {
  target: 'trader-insights',
  minimumScore: 80,
  minimumEdge: 85,
  minimumTrust: 85,
  confidenceFloor: 0.6,
  boardCaps: { perSlate: 15, perSport: 10, perGame: 2 },
  weights: {
    edge: 0.40,        // ← higher edge weight for sharper market-alerts lane
    trust: 0.30,
    readiness: 0.15,
    uniqueness: 0.10,
    boardFit: 0.05,
  },
  version: 'trader-insights-v2',
};

export const exclusiveInsightsPromotionPolicy: PromotionPolicy = {
  target: 'exclusive-insights',
  minimumScore: 90,
  minimumEdge: 90,
  minimumTrust: 88,
  confidenceFloor: 0.6,
  boardCaps: { perSlate: 15, perSport: 10, perGame: 2 },
  weights: {
    edge: 0.45,        // ← highest edge weight for top-tier VIP lane
    trust: 0.30,
    readiness: 0.10,
    uniqueness: 0.10,
    boardFit: 0.05,
  },
  version: 'exclusive-insights-v2',
};
```

### Step 2: Fix `calculateScore()` to use `policy.weights`

In `packages/domain/src/promotion.ts`, change `calculateScore` signature and implementation:

```typescript
function calculateScore(
  input: BoardPromotionEvaluationInput,
  weights: PromotionScoreWeights,
): PromotionScoreBreakdown {
  const e = normalizeScore(input.scoreInputs.edge);
  const t = normalizeScore(input.scoreInputs.trust);
  const r = normalizeScore(input.scoreInputs.readiness);
  const u = normalizeScore(input.scoreInputs.uniqueness);
  const b = normalizeScore(input.scoreInputs.boardFit);

  return {
    edge: e * weights.edge,
    trust: t * weights.trust,
    readiness: r * weights.readiness,
    uniqueness: u * weights.uniqueness,
    boardFit: b * weights.boardFit,
    total: e * weights.edge + t * weights.trust + r * weights.readiness + u * weights.uniqueness + b * weights.boardFit,
  };
}
```

Call site in `evaluatePromotionEligibility`:
```typescript
const breakdown = calculateScore(input, policy.weights);
```

Fix `buildDecision` explanation:
```typescript
explanation: {
  target: input.input.target,
  reasons: input.reasons,
  suppressionReasons: input.suppressionReasons,
  weights: input.policyWeights,   // ← pass weights through, not hardcoded
},
```

### Step 3: `ScoringProfile` type

Add to `packages/contracts/src/promotion.ts`:

```typescript
/**
 * A named scoring profile is a set of promotion policies (one per target)
 * that can be selected at runtime via env var. Profiles allow weight
 * experimentation without code deploys.
 *
 * All three canonical targets must be present in every profile.
 * Missing targets would silently disable promotion for that lane.
 */
export interface ScoringProfile {
  /** Unique identifier written to pick_promotion_history.metadata.scoringProfile */
  name: string;
  description: string;
  policies: {
    'best-bets': PromotionPolicy;
    'trader-insights': PromotionPolicy;
    'exclusive-insights': PromotionPolicy;
  };
}
```

### Step 4: Named profile registry

Add to `packages/contracts/src/promotion.ts`:

```typescript
/**
 * Default profile — current production weights.
 * This is the baseline; all experiments are deltas from this.
 */
export const defaultScoringProfile: ScoringProfile = {
  name: 'default',
  description: 'Production baseline weights (best-bets-v2, trader-insights-v2, exclusive-insights-v2)',
  policies: {
    'best-bets': bestBetsPromotionPolicy,
    'trader-insights': traderInsightsPromotionPolicy,
    'exclusive-insights': exclusiveInsightsPromotionPolicy,
  },
};

/**
 * Conservative profile — higher edge weight, lower trust weight.
 * Use when you want to prioritize pure mathematical edge over capper trust signals.
 */
export const conservativeScoringProfile: ScoringProfile = {
  name: 'conservative',
  description: 'Edge-weighted variant: edge +5%, trust -5% across all targets',
  policies: {
    'best-bets': {
      ...bestBetsPromotionPolicy,
      weights: { edge: 0.40, trust: 0.20, readiness: 0.20, uniqueness: 0.10, boardFit: 0.10 },
      version: 'best-bets-conservative-v1',
    },
    'trader-insights': {
      ...traderInsightsPromotionPolicy,
      weights: { edge: 0.45, trust: 0.25, readiness: 0.15, uniqueness: 0.10, boardFit: 0.05 },
      version: 'trader-insights-conservative-v1',
    },
    'exclusive-insights': {
      ...exclusiveInsightsPromotionPolicy,
      weights: { edge: 0.50, trust: 0.25, readiness: 0.10, uniqueness: 0.10, boardFit: 0.05 },
      version: 'exclusive-insights-conservative-v1',
    },
  },
};

export const scoringProfiles: Record<string, ScoringProfile> = {
  default: defaultScoringProfile,
  conservative: conservativeScoringProfile,
};

export function resolveScoringProfile(name: string | undefined): ScoringProfile {
  const key = name ?? 'default';
  const profile = scoringProfiles[key];
  if (!profile) {
    throw new Error(
      `Unknown scoring profile "${key}". Available: ${Object.keys(scoringProfiles).join(', ')}`,
    );
  }
  return profile;
}
```

### Step 5: Promotion service reads profile at startup

In `apps/api/src/promotion-service.ts`, the active profile is resolved once at module load:

```typescript
import { resolveScoringProfile } from '@unit-talk/contracts';

const activeScoringProfile = resolveScoringProfile(process.env.UNIT_TALK_SCORING_PROFILE);

export function activePromotionPolicies() {
  return [
    activeScoringProfile.policies['exclusive-insights'],
    activeScoringProfile.policies['trader-insights'],
    activeScoringProfile.policies['best-bets'],
  ] as const;
}
```

### Step 6: Profile name written to `pick_promotion_history`

When persisting a promotion decision, write `activeScoringProfile.name` to the history row's `metadata`:

```typescript
metadata: {
  scoringProfile: activeScoringProfile.name,
  policyVersion: policy.version,
  // ... existing fields
}
```

This makes every promotion decision traceable to the profile that produced it.

---

## Env Var Reference

Add to `.env.example`:
```
# Scoring profile for promotion evaluation. Options: default, conservative
# Default: default
UNIT_TALK_SCORING_PROFILE=default
```

---

## Acceptance Criteria (UTV2-136)

- [ ] `PromotionPolicy.weights: PromotionScoreWeights` added to interface in `packages/contracts`
- [ ] All three policy constants updated with explicit weights
- [ ] `calculateScore()` uses `policy.weights` instead of hardcoded `bestBetsScoreWeights`
- [ ] `buildDecision()` explanation uses `policy.weights` instead of hardcoded `bestBetsScoreWeights`
- [ ] `ScoringProfile` type exported from `@unit-talk/contracts`
- [ ] `defaultScoringProfile` and `conservativeScoringProfile` defined
- [ ] `resolveScoringProfile(name)` exported from `@unit-talk/contracts`
- [ ] `activePromotionPolicies()` in `apps/api/src/promotion-service.ts` uses `activeScoringProfile`
- [ ] `UNIT_TALK_SCORING_PROFILE` env var read at startup; invalid value = startup error
- [ ] Profile name written to `pick_promotion_history.metadata.scoringProfile`
- [ ] `pnpm verify` passes
- [ ] New test: `conservativeScoringProfile` produces different scores than `defaultScoringProfile` for the same inputs

---

## Migration Safety

All weight changes are additive (new field on existing interface). No DB migration required. The `pick_promotion_history.metadata` field is `jsonb` — adding a new key is backward-compatible.

Existing promotion history rows will not have `scoringProfile` in metadata — this is expected. They predate the registry. New rows will always have it.

---

## Note on the Weights Bug

The hardcoded `bestBetsScoreWeights` in `calculateScore()` and `buildDecision()` means all historical trader-insights and exclusive-insights decisions were computed with best-bets weights (edge: 0.35). This does not invalidate past decisions — the `minimumScore`, `minimumEdge`, and `minimumTrust` thresholds still filtered correctly. But the score values in `pick_promotion_history.score` are slightly incorrect for non-best-bets lanes. No retroactive correction is required — the fix applies forward from this change.
