# T1 discord:exclusive-insights Activation Contract

**Status:** RATIFIED 2026-03-28
**Issue:** UTV2-87
**Lane:** claude (contract) → codex (implementation)
**Tier:** T1 — touches live promotion policy, DB schema, and Discord routing
**Authority:** This document is the authoritative specification for activating `discord:exclusive-insights` as a live pick delivery target in Unit Talk V2.

---

## 1. Activation Decision

**`discord:exclusive-insights` is APPROVED for activation** as a third pick delivery target, positioned above `discord:trader-insights`.

### Rationale

- `discord:best-bets` serves high-signal plays (min score 70)
- `discord:trader-insights` serves sharp-money + high-edge plays (min score 80)
- `discord:exclusive-insights` serves the highest-quality tier — picks with elite scoring across edge, trust, and readiness (min score 90)
- The channel exists and is in `UNIT_TALK_DISCORD_TARGET_MAP` (`1288613114815840466`)
- Priority routing: `exclusive-insights` wins over `trader-insights` which wins over `best-bets`

---

## 2. Current State

| Surface | State |
|---------|-------|
| Channel ID | `1288613114815840466` — confirmed in `discord_routing.md` |
| `UNIT_TALK_DISCORD_TARGET_MAP` | Already includes `discord:exclusive-insights` |
| DB CHECK constraint | Currently allows `('best-bets', 'trader-insights')` — must add `'exclusive-insights'` |
| Promotion policy | Does not yet exist — must be added to `@unit-talk/domain` |
| Promotion service | Evaluates best-bets + trader-insights eagerly — must add exclusive-insights |

---

## 3. Promotion Policy

### 3.1 Policy Definition

```typescript
// Add to packages/domain/src/promotion/
export const exclusiveInsightsPromotionPolicy: PromotionPolicy = {
  promotionTarget: 'exclusive-insights',
  minimumScore: 90,
  minimumEdge: 90,
  minimumTrust: 88,
  version: 'exclusive-insights-v1',
};
```

### 3.2 Score Tier Ladder

| Target | Minimum Score | Minimum Edge | Minimum Trust |
|--------|--------------|--------------|---------------|
| `best-bets` | 70 | — | — |
| `trader-insights` | 80 | 85 | 85 |
| `exclusive-insights` | 90 | 90 | 88 |

### 3.3 Priority Rule

When a pick qualifies for multiple targets, it routes to the **highest-tier target only**. Priority: `exclusive-insights` > `trader-insights` > `best-bets`.

This is already enforced by `evaluateAllPoliciesEagerAndPersist()` — the first policy match wins in priority order. **Add `exclusive-insights` as the first policy evaluated.**

---

## 4. Schema Migration Required

Migration must add `'exclusive-insights'` to both CHECK constraints:

```sql
-- Migration: 202603XXXXXX_add_exclusive_insights_target.sql

ALTER TABLE picks
  DROP CONSTRAINT IF EXISTS picks_promotion_target_check,
  ADD CONSTRAINT picks_promotion_target_check
    CHECK (promotion_target IN ('best-bets', 'trader-insights', 'exclusive-insights'));

ALTER TABLE pick_promotion_history
  DROP CONSTRAINT IF EXISTS pick_promotion_history_target_check,
  ADD CONSTRAINT pick_promotion_history_target_check
    CHECK (promotion_target IN ('best-bets', 'trader-insights', 'exclusive-insights'));
```

`pnpm supabase:types` must be re-run after migration.

---

## 5. Implementation Scope (UTV2-87 Codex)

- [ ] Migration: add `'exclusive-insights'` to both CHECK constraints
- [ ] Run `pnpm supabase:types`
- [ ] Add `exclusiveInsightsPromotionPolicy` to `packages/domain/src/`
- [ ] Wire `exclusive-insights` as first policy in `evaluateAllPoliciesEagerAndPersist()` priority order
- [ ] Add `'exclusive-insights'` to `@unit-talk/contracts` `promotionTargets` array
- [ ] Update `distribution-service.ts` gate to accept `exclusive-insights` target
- [ ] ≥ 4 net-new tests: policy qualification at threshold, below-threshold rejection, priority routing (exclusive wins over trader-insights), distribution gate accepts target
- [ ] `pnpm verify` exits 0

**Do NOT:**
- Change best-bets or trader-insights thresholds
- Add new Discord channels beyond this target
- Change the embed format (reuse existing worker delivery path)
- Implement per-user subscription preferences

---

## 6. Canary-First Proof Gate (Claude lane, post-implementation)

Before `discord:exclusive-insights` receives real-channel posts:

1. Submit a pick with promotion scores ≥ 90/90/88 (edge/trust overall)
2. Verify promotion history shows `exclusive-insights` qualified + `trader-insights` did not also fire as the routed target
3. Verify outbox entry targets `discord:exclusive-insights`
4. Canary preview: change `UNIT_TALK_DISTRIBUTION_TARGETS` to include `discord:canary` — confirm worker delivery
5. Real-channel activation: add `discord:exclusive-insights` to `UNIT_TALK_DISTRIBUTION_TARGETS`
6. Verify Discord message appears in `#exclusive-insights` channel

Proof recorded at `out/sprints/UTV2-87/`.

---

## 7. Rollback

If exclusive-insights posts are incorrect or volume is wrong:

1. Remove `discord:exclusive-insights` from `UNIT_TALK_DISTRIBUTION_TARGETS` (env change, no deploy)
2. Picks remain in outbox — can re-deliver once fixed
3. Do not revert migration — the CHECK constraint change is additive and safe

---

## 8. Out of Scope

- Per-user VIP+ role gating (enforcement is at Discord channel permissions, not V2 routing)
- New embed format for exclusive-insights (same worker embed as other pick delivery)
- S-tier / grade-based routing (V2 routes by promotion score, not legacy tier labels)
- Capper Tier System (separate contract required)

---

## 9. Authority and Update Rules

Update this contract only if:
- The minimum score threshold is tuned based on observed pick volume
- The priority order changes
- New fields are added to the promotion policy

Do not update to reflect implementation details.
