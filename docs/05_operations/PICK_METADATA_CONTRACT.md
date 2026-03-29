# PickMetadata Contract

**Status:** RATIFIED 2026-03-29
**Lane:** claude (contract) — codex (implementation: UTV2-122)
**Authority:** This document is the canonical definition of `picks.metadata` field structure.

---

## Problem

`picks.metadata` is declared as `Record<string, unknown>` in `@unit-talk/contracts`. It carries 14+ ad-hoc fields written by multiple services (submission, promotion, CLV, grading). No single authoritative type exists. Consumers use `as any` casts or optional chaining on unknown keys, creating silent drift.

---

## PickMetadata Interface

The following interface is to be added to `packages/contracts/src/picks.ts` and used as the type for `CanonicalPick.metadata`.

```typescript
/**
 * Canonical metadata structure for a pick.
 *
 * All fields are optional — not every pick will have every field populated.
 * Fields are written by different services at different stages of the lifecycle:
 *   - submission-service: routing, gate, domain analysis fields
 *   - promotion-service: promotionScores (if explicitly overriding domain analysis)
 *   - clv-service: clvRaw, clvPercent, beatsClosingLine (written at settlement)
 *
 * Never add fields to this interface without updating this contract doc.
 */
export interface PickMetadata {
  // ── Routing / gate signals ─────────────────────────────────────────────────
  /** Sport key (e.g. 'nfl', 'nba', 'mlb'). Used for board caps and routing. */
  sport?: string;
  /** Human-readable event name. Used for board uniqueness checks. */
  eventName?: string;
  /** True if the pick was submitted after the market posting window closed. */
  postingWindowClosed?: boolean;
  /** True if the pick is stale (event already started or passed). */
  isStale?: boolean;
  /** True if the market is still valid at evaluation time. */
  marketStillValid?: boolean;
  /** True if the pick has been blocked by risk rules. */
  riskBlocked?: boolean;

  // ── Domain analysis ────────────────────────────────────────────────────────
  /**
   * Output of the domain analysis pipeline at submission time.
   * Written by submission-service via DomainAnalysisService.
   */
  domainAnalysis?: {
    /** Raw edge = confidence - impliedProbability. Range: ~-0.5 to +0.5 */
    edge: number;
    /** True if edge > 0 */
    hasPositiveEdge: boolean;
    /** Implied probability from devigged odds. Range: 0–1 */
    impliedProbability: number;
    /** Kelly fraction (full Kelly). Range: 0–1 */
    kellyFraction?: number;
    /** Recommended stake as fraction of bankroll. Range: 0–1 */
    recommendedStake?: number;
    /** Devigging result if applicable */
    deviggingResult?: {
      fairOdds: number;
      margin: number;
      method: string;
    };
  };

  // ── Explicit promotion score overrides ────────────────────────────────────
  /**
   * Explicit promotion score overrides (0–100 each).
   * When present, these take priority over domain analysis fallbacks.
   * When absent, domain analysis signals and confidence are used as fallbacks.
   * See `readPromotionScoreInputs()` in promotion-service.ts for fallback logic.
   */
  promotionScores?: {
    edge?: number;
    trust?: number;
    readiness?: number;
    uniqueness?: number;
    boardFit?: number;
  };

  // ── CLV (written at settlement) ───────────────────────────────────────────
  /**
   * Closing Line Value — written by clv-service at settlement time.
   * Not present on ungraded picks.
   */
  clvRaw?: number;
  /** CLV as a percentage. E.g. +5.2 means 5.2% better than closing line. */
  clvPercent?: number;
  /** True if the pick odds were better than the closing line. */
  beatsClosingLine?: boolean;

  // ── Auxiliary / pass-through ───────────────────────────────────────────────
  /**
   * Catch-all for auxiliary fields not yet promoted to typed properties.
   * Do not rely on this for any business logic — promote to typed fields instead.
   */
  [key: string]: unknown;
}
```

---

## Migration Path (Codex: UTV2-122)

1. Add `PickMetadata` interface to `packages/contracts/src/picks.ts`
2. Change `CanonicalPick.metadata` from `Record<string, unknown>` to `PickMetadata`
3. Update all write sites to use typed assignment (no `as any`):
   - `apps/api/src/submission-service.ts`
   - `apps/api/src/promotion-service.ts`
   - `apps/api/src/clv-service.ts`
   - `apps/api/src/grading-service.ts`
4. Update all read sites to use typed access:
   - `apps/api/src/promotion-service.ts` — `readMetadataString`, `readMetadataBoolean`, `readDomainAnalysisEdgeScore`, etc.
   - `apps/operator-web/src/server.ts` — snapshot builder
5. Run `pnpm verify` — all existing tests must pass, zero new type errors

---

## Invariants

- `metadata.domainAnalysis` is written at submission time by `DomainAnalysisService`. It is **never written at promotion or settlement time**.
- `metadata.clvRaw`, `clvPercent`, `beatsClosingLine` are written **only** at graded settlement. They are absent on any pick that has not been settled.
- `metadata.promotionScores` is an **override**. When absent, domain analysis fallbacks apply. When present, they take priority.
- No service may write arbitrary top-level metadata keys without updating this contract.
