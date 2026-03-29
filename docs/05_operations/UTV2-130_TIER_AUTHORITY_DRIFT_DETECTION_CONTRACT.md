# Tier Authority Drift Detection Contract

**Status:** RATIFIED 2026-03-29
**Lane:** claude (contract) — codex (implementation: UTV2-130)
**Authority:** Defines startup-time drift detection when `UNIT_TALK_ENABLED_TARGETS` overrides a `defaultTargetRegistry`-disabled target.

**Depends on:** UTV2-129 (Promotion Target Registry) — must be merged first.

---

## Problem

`defaultTargetRegistry` in `@unit-talk/contracts` encodes which targets are safe for live delivery (`exclusive-insights` is `enabled: false` with a documented reason). An operator can override this via `UNIT_TALK_ENABLED_TARGETS=best-bets,trader-insights,exclusive-insights`. When this happens, there is no log signal or warning — the target is silently activated, bypassing the registry's documented safety gate.

This is a governance gap. The registry exists to enforce the activation contract requirement for `exclusive-insights`. An override should be auditable.

---

## Design

### Startup check in `apps/worker/src/runner.ts`

At worker startup (inside `createWorkerRuntime` or at the top of the main entry point), after `resolveTargetRegistry()` is called:

```typescript
import { defaultTargetRegistry, resolveTargetRegistry, isTargetEnabled } from '@unit-talk/contracts';

function checkTargetRegistryDrift(
  logger: Logger,
  env: Pick<NodeJS.ProcessEnv, 'UNIT_TALK_ENABLED_TARGETS'> = process.env,
): void {
  const raw = env.UNIT_TALK_ENABLED_TARGETS?.trim();
  if (!raw) {
    // No override — using defaultTargetRegistry. No drift possible.
    return;
  }

  const resolved = resolveTargetRegistry(env);

  for (const resolved_entry of resolved) {
    if (!resolved_entry.enabled) continue;

    const defaultEntry = defaultTargetRegistry.find(e => e.target === resolved_entry.target);
    if (defaultEntry && !defaultEntry.enabled) {
      logger.warn({
        event: 'target-registry.drift-detected',
        target: resolved_entry.target,
        defaultDisabledReason: defaultEntry.disabledReason ?? 'no reason given',
        override: 'UNIT_TALK_ENABLED_TARGETS',
        message: `Target "${resolved_entry.target}" is enabled via UNIT_TALK_ENABLED_TARGETS but is disabled in defaultTargetRegistry. Ensure activation contract is satisfied before proceeding.`,
      });
    }
  }
}
```

**Fail-open:** This check logs a structured warning and does not block startup. The worker continues normally. Operators are responsible for acknowledging the warning.

### Log format

The warning is a structured JSON log entry (consistent with Wave 1 structured logging):

```json
{
  "level": "warn",
  "event": "target-registry.drift-detected",
  "target": "exclusive-insights",
  "defaultDisabledReason": "Activation contract required before live delivery (see T1_EXCLUSIVE_INSIGHTS_ACTIVATION_CONTRACT.md)",
  "override": "UNIT_TALK_ENABLED_TARGETS",
  "message": "Target \"exclusive-insights\" is enabled via UNIT_TALK_ENABLED_TARGETS but is disabled in defaultTargetRegistry. Ensure activation contract is satisfied before proceeding."
}
```

### Call site

```typescript
// In apps/worker/src/main.ts or index.ts, after env is loaded:
const logger = createLogger('worker');
checkTargetRegistryDrift(logger);
```

The check runs once at startup. It does not repeat per tick.

---

## Scope

| File | Change |
|---|---|
| `apps/worker/src/runner.ts` | Add `checkTargetRegistryDrift()` function |
| `apps/worker/src/main.ts` (or index.ts) | Call `checkTargetRegistryDrift(logger)` at startup |

No changes to `@unit-talk/contracts`. No changes to `resolveTargetRegistry()` — it is a pure function, drift check wraps it externally.

---

## Migration Safety

No DB migrations. No schema changes. No new env vars.

---

## Acceptance Criteria (UTV2-130)

- [ ] `checkTargetRegistryDrift()` implemented in `apps/worker/src/runner.ts`
- [ ] Called once at worker startup
- [ ] If `UNIT_TALK_ENABLED_TARGETS` enables a target that `defaultTargetRegistry` has `enabled: false`: structured warn log emitted with `event: 'target-registry.drift-detected'`, `target`, `defaultDisabledReason`
- [ ] If no override present: no log emitted
- [ ] If override does not conflict with `defaultTargetRegistry`: no log emitted
- [ ] Worker does NOT fail to start (fail-open)
- [ ] `pnpm verify` passes
- [ ] New tests:
  - `checkTargetRegistryDrift()` emits warn when `UNIT_TALK_ENABLED_TARGETS` enables a defaultRegistry-disabled target
  - No warn when no override present
  - No warn when override enables only defaultRegistry-enabled targets

---

## Out of Scope

- Blocking worker startup on drift (fail-closed behavior — this is a future governance hardening decision)
- Drift detection at the API/distribution-service layer
- Drift detection for scoring profiles (`UNIT_TALK_SCORING_PROFILE`) — separate concern
