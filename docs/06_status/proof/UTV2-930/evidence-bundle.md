# Evidence Bundle — UTV2-930 Unified Lifecycle Specification

schema: evidence-bundle/v1
issue: UTV2-930
tier: T1
branch: claude/utv2-930-unified-lifecycle-spec
branch_sha: 2a3813c9ff029e60483950ca20c7fc63fe5ff81d
merge_sha: (populated after merge)
generated_at: 2026-05-17T04:30:00.000Z
verifier: claude-sonnet-4-6

---

## Summary

Establishes `packages/contracts` as the single source of truth for the pick delivery lifecycle FSM. Removes the duplicate `allowedTransitions` map from `packages/db/src/lifecycle.ts` and redirects all callers to the canonical `pickLifecycleTransitions` constant in `packages/contracts/src/picks.ts`. Adds a cross-package drift detection test (`lifecycle-matrix.test.ts`) that will fail CI if the DB layer and contracts matrix diverge. Clarifies that `packages/domain/src/lifecycle-validator.ts` describes a separate outcome lifecycle (pending→won/lost) and is intentionally distinct.

---

## Changes

| File | Change |
|------|--------|
| `packages/contracts/src/picks.ts` | Added `pickLifecycleTransitions`, `isAllowedLifecycleTransition`, `isTerminalLifecycleState`, `getAllowedLifecycleTransitions` — canonical FSM exports |
| `packages/db/src/lifecycle.ts` | Removed local `allowedTransitions` map; imports and delegates to contracts helpers; removed `allowedTransitions` usages in `transitionPickLifecycle` and `atomicClaimForTransition` |
| `packages/domain/src/lifecycle-validator.ts` | Fixed broken conditional type derivation; added doc comment clarifying this is the outcome lifecycle (separate from delivery lifecycle) |
| `packages/db/src/lifecycle-matrix.test.ts` | NEW: 6 cross-package drift detection tests |
| `.lane/lanes/governance.yml` | Added `packages/db/src/**` and `packages/domain/src/**` to allowed path globs |
| `package.json` | Added `lifecycle-matrix.test.ts` to `test:apps-rest` suite |

---

## Invariants Enforced

1. **Single source of truth**: `pickLifecycleTransitions` in `@unit-talk/contracts` is the only place the delivery lifecycle FSM is defined.
2. **DB delegates**: `packages/db/src/lifecycle.ts` has zero local FSM state — all transition logic derives from contracts.
3. **Drift detection**: `lifecycle-matrix.test.ts` runs in CI and fails if `getAllowedTransitions()` in DB diverges from `getAllowedLifecycleTransitions()` in contracts for any state.
4. **Outcome lifecycle is distinct**: Domain's `lifecycle-validator.ts` (pending→won/lost) is explicitly documented as the outcome lifecycle, not a duplicate of the delivery lifecycle.

---

## Verification

### pnpm verify

```
EXIT_CODE: 0
pnpm ops:sync-check  ✓
pnpm env:check       ✓
pnpm lint            ✓
pnpm type-check      ✓
pnpm build           ✓
pnpm test            ✓ (all suites, including lifecycle-matrix.test.ts: 6/6 pass)
pnpm verify:commands ✓
```

### pnpm test:db (live Supabase)

```
✔ database repository bundle persists a submission and settlement when Supabase is configured (47135ms)
✔ UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row (45694ms)
✔ UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes (40407ms)
✔ UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row (41872ms)
✔ UTV2-883: no duplicate participants for the same external_id and sport (570ms)
tests 5 | pass 5 | fail 0
duration_ms 176265
```

### lifecycle-matrix.test.ts (drift detection)

```
✔ contracts FSM covers all 7 canonical delivery lifecycle states
✔ db getAllowedTransitions matches contracts matrix for every state
✔ db isTerminalState matches contracts isTerminalLifecycleState
✔ contracts terminal states are settled and voided only
✔ contracts isAllowedLifecycleTransition is consistent with matrix
✔ no regression transitions exist in the matrix
tests 6 | pass 6 | fail 0
```

### R-level check

```
Verdict: PASS
Rules matched: (none) — no R-level artifacts required for this diff
```

---

## Canonical FSM (contracts authority)

```typescript
export const pickLifecycleTransitions: Readonly<
  Record<PickLifecycleState, readonly PickLifecycleState[]>
> = {
  draft: ['validated', 'voided'],
  validated: ['queued', 'awaiting_approval', 'voided'],
  awaiting_approval: ['queued', 'voided'],
  queued: ['posted', 'voided'],
  posted: ['settled', 'voided'],
  settled: [],
  voided: [],
};
```

Terminal states: `settled`, `voided`. No regression transitions permitted.
`awaiting_approval` is the Phase 7A governance brake for non-human producers.
