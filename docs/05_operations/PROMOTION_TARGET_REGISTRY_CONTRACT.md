# Promotion Target Registry Contract

**Status:** RATIFIED 2026-03-29
**Lane:** claude (contract) — codex (implementation: UTV2-129)
**Authority:** Defines the runtime target activation registry in `@unit-talk/contracts` and worker enforcement.

---

## Problem

Promotion targets (`best-bets`, `trader-insights`, `exclusive-insights`) are activated implicitly — by their presence in the policy list and the worker's env-var target map. There is no explicit runtime kill switch per target. Disabling a target requires:

1. Removing it from `UNIT_TALK_WORKER_TARGETS` (env change → restart), or
2. Commenting out the policy in `activePromotionPolicies()` (code deploy)

Neither option is fast or observable. The current "BLOCKED" status in `CLAUDE.md` is a docs-level control, not a machine-enforceable one. An operator who sets `UNIT_TALK_WORKER_TARGETS=best-bets,trader-insights,exclusive-insights` without checking docs would activate a blocked target.

---

## Design

### `promotionTargetRegistry` in `@unit-talk/contracts`

```typescript
export interface TargetRegistryEntry {
  target: PromotionTarget;
  /** Whether delivery to this target is permitted. false = skip without failing. */
  enabled: boolean;
  /** Human-readable reason if disabled. For operator surface / logs. */
  disabledReason?: string;
}

/**
 * Canonical target registry — the V2 source of truth for which targets
 * are permitted to receive live deliveries.
 *
 * Enabled/disabled state is the runtime equivalent of the "Live / Blocked"
 * table in CLAUDE.md. This registry makes that gate machine-enforceable.
 *
 * Override at startup via UNIT_TALK_ENABLED_TARGETS env var.
 * Disabled targets are skipped by the distribution worker — outbox rows
 * for a disabled target are left in 'pending' status and not failed.
 */
export const defaultTargetRegistry: TargetRegistryEntry[] = [
  {
    target: 'best-bets',
    enabled: true,
  },
  {
    target: 'trader-insights',
    enabled: true,
  },
  {
    target: 'exclusive-insights',
    enabled: false,
    disabledReason: 'Activation contract required before live delivery (see T1_EXCLUSIVE_INSIGHTS_ACTIVATION_CONTRACT.md)',
  },
];
```

### Runtime registry resolution

```typescript
/**
 * Returns the effective registry, applying UNIT_TALK_ENABLED_TARGETS override if set.
 *
 * UNIT_TALK_ENABLED_TARGETS is a comma-separated list of explicitly enabled targets.
 * Targets NOT in the list are disabled, regardless of defaultTargetRegistry.
 *
 * If env var is absent, defaultTargetRegistry is used as-is.
 *
 * Examples:
 *   UNIT_TALK_ENABLED_TARGETS=best-bets,trader-insights
 *   → exclusive-insights disabled even if defaultTargetRegistry has it enabled
 *
 *   UNIT_TALK_ENABLED_TARGETS=best-bets
 *   → trader-insights disabled even though it is live by default
 */
export function resolveTargetRegistry(
  env: Pick<NodeJS.ProcessEnv, 'UNIT_TALK_ENABLED_TARGETS'> = process.env,
): TargetRegistryEntry[] {
  const raw = env.UNIT_TALK_ENABLED_TARGETS?.trim();
  if (!raw) {
    return defaultTargetRegistry;
  }

  const explicitlyEnabled = new Set(
    raw.split(',').map(t => t.trim()).filter(Boolean)
  );

  return promotionTargets.map(target => ({
    target,
    enabled: explicitlyEnabled.has(target),
    disabledReason: explicitlyEnabled.has(target)
      ? undefined
      : `Not in UNIT_TALK_ENABLED_TARGETS`,
  }));
}

export function isTargetEnabled(
  target: string,
  registry: TargetRegistryEntry[],
): boolean {
  const entry = registry.find(e => e.target === target);
  return entry?.enabled ?? false;
}
```

---

## Worker Integration

In `apps/worker/src/runner.ts`, the registry is resolved at startup and checked in `runWorkerCycles` before processing each target:

```typescript
export interface WorkerRunnerOptions {
  repositories: RepositoryBundle;
  workerId: string;
  targets: string[];
  deliver: DeliveryAdapter;
  targetRegistry?: TargetRegistryEntry[];  // ← add; defaults to resolveTargetRegistry()
  circuitBreaker?: DeliveryCircuitBreaker;
  maxCycles?: number | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  pollIntervalMs?: number | undefined;
}
```

In the per-target loop:

```typescript
const registry = options.targetRegistry ?? resolveTargetRegistry();

for (const target of options.targets) {
  if (!isTargetEnabled(target, registry)) {
    // Log once at startup (not per tick) — do not fail outbox rows
    results.push({ status: 'target-disabled', target, workerId: options.workerId });
    continue;
  }

  if (cb.isOpen(target)) { ... }

  const result = await processNextDistributionWork(...);
  // ...
}
```

Add `WorkerProcessTargetDisabledResult` to the result union:

```typescript
export interface WorkerProcessTargetDisabledResult {
  status: 'target-disabled';
  target: string;
  workerId: string;
}
```

**Critical:** disabled target skip leaves outbox rows in `pending` status — they are NOT failed or dead-lettered. This is intentional — when a target is re-enabled, those rows will be processed normally on the next tick.

---

## Distribution Service Integration

In `apps/api/src/distribution-service.ts`, the distribution gate also checks the registry before enqueuing an outbox row. This prevents rows from being created for disabled targets in the first place:

```typescript
const registry = resolveTargetRegistry();

if (!isTargetEnabled(resolvedTarget, registry)) {
  // Do not enqueue — log and return gracefully
  return { enqueued: false, reason: 'target-disabled', target: resolvedTarget };
}
```

This is a belt-and-suspenders check — the worker skip is the primary gate, the distribution service check prevents unnecessary outbox row creation.

---

## Operator Snapshot

Add to `OperatorSnapshot`:

```typescript
targetRegistry?: Array<{
  target: PromotionTarget;
  enabled: boolean;
  disabledReason?: string;
}>;
```

Populated by `resolveTargetRegistry()` at snapshot build time — operator can see which targets are active without reading env vars.

---

## Env Var Reference

Add to `.env.example`:

```
# Comma-separated list of enabled distribution targets.
# Targets not in this list are disabled — outbox rows for them are skipped (not failed).
# If absent, defaultTargetRegistry from @unit-talk/contracts is used.
# Default: best-bets and trader-insights are enabled; exclusive-insights is disabled.
# UNIT_TALK_ENABLED_TARGETS=best-bets,trader-insights
```

---

## Acceptance Criteria (UTV2-129)

- [ ] `TargetRegistryEntry` interface and `defaultTargetRegistry` exported from `@unit-talk/contracts`
- [ ] `resolveTargetRegistry(env?)` exported from `@unit-talk/contracts`
- [ ] `isTargetEnabled(target, registry)` exported from `@unit-talk/contracts`
- [ ] `defaultTargetRegistry` reflects current live state: best-bets=enabled, trader-insights=enabled, exclusive-insights=disabled
- [ ] `WorkerRunnerOptions.targetRegistry` added; registry checked per-target before processing
- [ ] Disabled target → `WorkerProcessTargetDisabledResult`; outbox rows left in `pending` (NOT failed)
- [ ] Distribution service checks registry before enqueuing
- [ ] `UNIT_TALK_ENABLED_TARGETS` env var documented in `.env.example`
- [ ] Operator snapshot includes `targetRegistry` field
- [ ] `pnpm verify` passes
- [ ] New test: worker with `exclusive-insights` disabled skips delivery; outbox row stays `pending`
- [ ] New test: `resolveTargetRegistry()` with `UNIT_TALK_ENABLED_TARGETS=best-bets` disables all other targets

---

## Out of Scope

- Per-pick granular target suppression (that is the override system already in place)
- Time-window-based target enablement (future)
- Rollout percentage per target (that is UTV2-154)
- Retroactively failing outbox rows for disabled targets
