# Verification: UTV2-1120 — Breach-to-Deployment-State Wiring (INIT-3.3.1)

## Verification

- **Tier:** T1
- **Verifier:** claude-sonnet-4-6 (orchestrator)
- **Implementation SHA:** 8779d7b7af7847575615c653f6dc4ee6161af300
- **Merge SHA:** set-by-ci

## Static proof

| Check | Result |
|---|---|
| pnpm verify | PASS (151/151 tests in domain-features suite) |
| type-check | PASS |
| lint | PASS |
| build | PASS |
| R-level check | PASS (no R-level artifacts required) |

## Live-DB proof

`pnpm test:db` — 7/7 PASS against live Supabase (`zfzdnfwdarxucxtaojxm`)

Duration: 35186 ms

## Implementation summary

`packages/domain/src/models/deployment-hold.ts` implements INIT-3.3.1:

- `DeploymentHold` — immutable record with audit event; `blocks_scoring: true` for held/quarantined
- `buildDeploymentHold()` — state transition: active→held, held→quarantined, quarantined stays
- `CalibrationBreach` — metric + threshold + actual_value + direction
- `DeploymentHoldAuditEvent` — append-only deployment-state-change record
- `evaluateBreachHold()` — fail-closed gate: any threshold violation triggers breach
- `BreachEvaluationInput/Result` — metrics evaluated against named thresholds

**Required invariants satisfied:**
- Calibration breach triggers automatic hold (no advisory path)
- Deployment-state changes emit AuditEvents (embedded in DeploymentHold)
- Calibration metrics reproducible from stored inputs (pure + deterministic)

## Adversarial validation

3 adversarial tests tagged `[ADVERSARIAL]`:
1. Injected brier_score breach → hold fires, blocks_scoring=true
2. Injected hit_rate breach (below threshold) → hold fires
3. Simultaneous multi-metric breach → all violations captured

Additional edge cases: at-threshold is not a breach, unknown metric skipped (no false positive), determinism.
