# Claude Critique — UTV2-916

**Issue:** UT-P0-003 Fix Worker Target Drift
**Branch:** codex/utv2-916-worker-target-drift
**Merge SHA:** (pending merge)
**Critic:** Claude Sonnet 4.6 (orchestrator)
**Date:** 2026-05-13

---

## Invariant Correctness

This PR enforces two guarantees: (1) blocked Discord channels cannot be activated via env-var config, and (2) enabled promotion targets must have matching worker delivery targets before any enqueue proceeds.

- **Blocked channels are immutable in contracts.** `blockedDiscordTargets` is a `const` tuple in `packages/contracts` — not overridable via env. `resolveTargetRegistry` forces `enabled: false` with `disabledReason` for blocked targets *before* any rollout-config override is applied. `isTargetEnabled` additionally double-checks `isPromotionTargetBlocked`. Two independent layers prevent re-activation.
- **Worker coverage check runs before enqueue.** `evaluateDistributionTargetGate` is called at the top of `enqueueDistributionWork`, before the governance brake check and before any outbox write. `enqueueDistributionWithRunTracking` (atomic enqueue path) also calls `evaluateDistributionTargetGate` before `enqueueDistributionAtomic`. The atomic bypass is closed.
- **`evaluateWorkerTargetCoverage` is pure.** Lives in `packages/contracts/src/promotion.ts` — no I/O, no DB, no env reads. Satisfies domain invariant #7.
- **`DistributionTargetMismatchError` carries structured report.** Includes `configuredWorkerTargets`, `enabledPromotionTargets`, `missingWorkerTargets`, `blockedWorkerTargets`. Observable and diagnosable without log-diving.

## Regression Risk

- **`parseGovernedPromotionTarget` removed, replaced by `parsePromotionTargetFromDeliveryTarget` from contracts.** The new function validates against the `promotionTargets` array rather than a hardcoded union check. Strictly more permissive — validation happens downstream at `isTargetEnabled`. Behavior for valid inputs is identical.
- **`resolveDeliveryTarget` env type widened to `string | undefined`.** Type narrowing only; no behavior change.
- **Module-level `rejectedTargetMismatchCount` counter.** Persists across calls in the same process; `resetDistributionTargetValidationStats()` must be called between tests that check the count. The test suite does this. Production: accumulating counter is appropriate for metrics. Fragile for test isolation but mitigated by the reset function.

## Finding: Worker Coverage Check Is Opt-In

`readConfiguredWorkerTargets` returns `undefined` when `UNIT_TALK_DISTRIBUTION_TARGETS` is absent from `env` (checked via `hasOwnProperty`). When `undefined`, the `evaluateWorkerTargetCoverage` call is skipped entirely. This means:

- Deployments without `UNIT_TALK_DISTRIBUTION_TARGETS` get **no** target-drift protection on the enqueue path.
- The blocked-channel protection (via `isTargetEnabled`) is always active regardless.
- The drift detection (enabled targets without worker coverage) is **opt-in** via env var configuration.

This is a valid backward-compatibility choice, but the deployment runbook must include `UNIT_TALK_DISTRIBUTION_TARGETS` to activate drift protection. Not a blocker, but must be documented.

## Scope Drift

None. Changed files match the declared scope: `packages/contracts/src/promotion.ts`, `apps/api/src/distribution-service.ts`, `apps/api/src/run-audit-service.ts`, `apps/worker/src/runtime.ts`, `packages/config/src/env.ts`, plus corresponding test files.

## Hidden Coupling

None found. All call sites of `resolveDeliveryTarget` and `parseGovernedPromotionTarget` are updated. No un-patched callers per diff review.

## Verdict

**APPROVE**

Core invariants enforced: blocked channels cannot be re-activated (two defense layers), atomic enqueue bypass is closed, worker coverage function is pure and tested. Two findings noted — opt-in drift detection (deployment gap, not a code bug) and module-level counter (mitigated by reset function). `pnpm verify` 113/0, `pnpm test:db` 2/0.

Runtime verification is still required before merge per T1 policy.
