# Rollout Controls Contract

**Status:** Ratified 2026-03-31
**Issue:** UTV2-154
**Authority:** Architecture — distribution pipeline gating contract
**Depends on:** UTV2-129 (promotion target registry — DONE)

---

## 1. Purpose

Extend the existing target registry (`resolveTargetRegistry()` in `@unit-talk/contracts`) with per-target rollout controls: percentage-based sampling, sport/attribute filters, and operator visibility. Together with simulation mode (UTV2-156) and the target registry (UTV2-129), this completes the safe activation pipeline:

```
simulate (UTV2-156) → canary (always) → gradual rollout (this contract) → full activation
```

## 2. Problem

The target registry is binary: enabled or disabled. There is no way to:

- Route 10% of qualifying picks to a new target before going to 100%
- Restrict a target to a specific sport (e.g., "only NBA picks to trader-insights for now")
- Adjust rollout percentage without a code deploy or process restart
- See rollout config state in Command Center

## 3. Design

### 3.1 Rollout config shape

Extend `TargetRegistryEntry` in `@unit-talk/contracts` with rollout fields:

```typescript
interface TargetRegistryEntry {
  target: PromotionTarget;
  enabled: boolean;
  disabledReason?: string;
  // New fields:
  rolloutPct: number;        // 0–100. 0 = kill switch. 100 = fully enabled.
  sportFilter?: string[];    // If set, only picks for these sports are eligible. Empty/undefined = all sports.
}
```

**Defaults when rollout fields are absent:**
- `rolloutPct` defaults to `100` (fully enabled, backward compatible)
- `sportFilter` defaults to `undefined` (all sports, backward compatible)

**Relationship to `enabled`:**
- `enabled: false` takes precedence — target is fully disabled regardless of `rolloutPct`
- `enabled: true, rolloutPct: 0` effectively disables the target (kill switch without changing `enabled`)
- `enabled: true, rolloutPct: 100, sportFilter: undefined` = current behavior (fully enabled, all sports)

### 3.2 Rollout config source

Env var: `UNIT_TALK_ROLLOUT_CONFIG` — JSON object keyed by target name.

```json
{
  "best-bets": { "rolloutPct": 100 },
  "trader-insights": { "rolloutPct": 50, "sportFilter": ["NBA", "MLB"] },
  "exclusive-insights": { "rolloutPct": 10 }
}
```

**Resolution order:**
1. If `UNIT_TALK_ROLLOUT_CONFIG` is set, parse and merge into the target registry entries
2. If not set, all targets use defaults (`rolloutPct: 100`, no sport filter)
3. `UNIT_TALK_ENABLED_TARGETS` continues to control the `enabled` boolean — rollout config only applies to enabled targets

**No DB config.** Env-var-only for this tier. DB-backed config is a future expansion if needed.

### 3.3 Sampling logic

Rollout sampling happens at **distribution time** (when the worker processes an outbox row), not at promotion time.

```
shouldDeliver(pick, target, registry):
  entry = registry[target]
  if !entry.enabled → skip (existing behavior)
  if entry.sportFilter && pick.sport not in entry.sportFilter → skip
  if entry.rolloutPct < 100:
    hash = deterministicHash(pick.id + target)  // stable per pick+target
    bucket = hash % 100
    if bucket >= entry.rolloutPct → skip
  → deliver
```

**Key design choices:**
- **Deterministic sampling**: Uses a hash of `pick.id + target`, not `Math.random()`. This means the same pick always gets the same decision for the same target. Retries don't flip the decision.
- **Per-target independence**: A pick can be in the 50% for `trader-insights` but out of the 50% for `exclusive-insights`.
- **Sport filter checked before rollout %**: If the sport doesn't match, the pick is skipped regardless of rollout percentage.

### 3.4 Skip behavior

When a pick is skipped due to rollout controls:
- The outbox row is marked `sent` with a receipt indicating rollout skip (not `dead_letter`)
- Receipt `receiptType`: `'worker.rollout-skip'`
- Receipt `channel`: `rollout-skip:<target>`
- Receipt `payload.reason`: `'rollout-pct'` or `'sport-filter'`
- The pick lifecycle is **not** affected — it remains in its current state
- The pick may still be delivered to other targets that it qualifies for

This is a **soft skip**, not a failure. The outbox row completes normally.

### 3.5 Operator visibility

Add to `OperatorSnapshot`:

```typescript
rolloutConfig: {
  [target: string]: {
    enabled: boolean;
    rolloutPct: number;
    sportFilter: string[] | null;
    skippedCount: number;  // count of rollout-skip receipts in recent window
  };
};
```

Dashboard shows:
- Per-target rollout percentage and sport filter (if any)
- Count of rollout-skipped picks in the current window
- Visual indicator when any target is < 100% rollout

## 4. Implementation Scope

### Allowed files

- `packages/contracts/src/promotion.ts` — extend `TargetRegistryEntry`, add rollout config parser
- `apps/worker/src/distribution-worker.ts` — add rollout sampling before delivery
- `apps/worker/src/runner.ts` — pass rollout config through
- `apps/worker/src/delivery-adapters.ts` — only if rollout-skip receipt needs a new adapter (likely not — use inline receipt)
- `apps/operator-web/src/server.ts` — add `rolloutConfig` to snapshot
- `apps/operator-web/src/routes/dashboard.ts` — display rollout config
- `apps/worker/src/worker-runtime.test.ts` — tests for sampling logic
- `apps/operator-web/src/server.test.ts` — tests for rollout config in snapshot

### Forbidden files

- `apps/api/src/*` — rollout sampling happens at delivery time, not at promotion/distribution enqueue
- `apps/discord-bot/*`, `apps/ingestor/*`, `apps/smart-form/*`, `apps/command-center/*`
- `@unit-talk/db` — no schema changes

## 5. Backward Compatibility

- If `UNIT_TALK_ROLLOUT_CONFIG` is not set, behavior is identical to current (all enabled targets at 100%, no sport filter)
- Existing `UNIT_TALK_ENABLED_TARGETS` continues to work unchanged
- No migration required
- No breaking changes to existing interfaces (new fields are optional with defaults)

## 6. Verification

- `pnpm type-check` passes
- `pnpm test` passes
- New tests:
  - `rolloutPct: 0` skips all picks for that target
  - `rolloutPct: 100` delivers all picks (same as current)
  - `rolloutPct: 50` deterministically samples ~50% (verify with 100 test picks)
  - `sportFilter: ['NBA']` skips non-NBA picks
  - Rollout-skip receipts have correct shape
  - Operator snapshot includes rollout config
  - Missing `UNIT_TALK_ROLLOUT_CONFIG` uses defaults (backward compat)

## 7. Rollback

Remove `UNIT_TALK_ROLLOUT_CONFIG` env var. All targets revert to 100% rollout with no sport filter. Rollout-skip receipts remain in `distribution_receipts` as historical records.

## 8. Future Expansion (out of scope)

- DB-backed rollout config (live toggle without restart)
- Per-capper rollout (only route picks from specific cappers)
- Time-based rollout (enable during specific hours)
- A/B testing (route to different targets for comparison)

These are explicitly out of scope for this contract.
