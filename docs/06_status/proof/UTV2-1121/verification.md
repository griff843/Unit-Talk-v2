# Verification: UTV2-1121 — Shadow-to-Active Calibration Gate (INIT-3.3.2)

## Verification

- **Tier:** T1
- **Verifier:** claude-sonnet-4-6 (orchestrator)
- **Implementation SHA:** 54cf85c9995f928f7e3eaf849261ee632bc3f5f8
- **Merge SHA:** set-by-ci

## Static proof

| Check | Result |
|---|---|
| pnpm verify | PASS (192/192 tests in domain-features suite) |
| type-check | PASS |
| lint | PASS |
| build | PASS |
| R-level check | PASS (no R-level artifacts required) |

## Live-DB proof

`pnpm test:db` — 7/7 PASS against live Supabase (`zfzdnfwdarxucxtaojxm`)

Duration: 35223 ms

## Implementation summary

`packages/domain/src/models/calibration-gate.ts` implements INIT-3.3.2:

- `CalibrationReport` — reproducible evidence of metric evaluation; status 'pass' only when ALL metrics pass
- `buildCalibrationReport()` — fail-closed: missing metrics fail, exact threshold boundary passes
- `CalibrationCertification` — append-only record issued when gate approves promotion
- `buildCalibrationCertification()` — issues cert from passing report; valid_until_ms = evaluated_at_ms + valid_for_ms
- `evaluateCalibrationGate()` — fail-closed gate: absent/failed/expired/pending reports all block promotion
- All decisions emit `CalibrationAuditEvent` as append-only records

**Required invariants satisfied:**
- No promotion without a passing CalibrationReport
- Promotion halts without calibration certification
- Reports reproducible from stored inputs (pure + deterministic)
- All promotion decisions are auditable (AuditEvent emitted on every call)

## Adversarial validation

3 adversarial tests tagged `[ADVERSARIAL]`:
1. Failing model (brier_score above threshold) → gate blocks, decision='blocked', block_reason='calibration_failed'
2. Multi-metric failure → all violations present, model blocked
3. Expired passing report → blocked even though it once passed (calibration_expired)

Additional edge cases: no report, pending report, pass+not-expired approved, exact boundary approved, determinism.
