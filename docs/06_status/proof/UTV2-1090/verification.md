# Proof Summary — UTV2-1090

**Issue:** INIT-1.3.3 — Automatic Quarantine and Escalation
**Tier:** T1
**Lane type:** governance
**SHA:** 4c42ff25428f93bb611630604b7abef6bbc7366b (branch HEAD at proof assembly — merge SHA to be bound post-merge)

## What Changed

`packages/invariants/src/quarantine.ts` — new `QuarantineManager` class (extends `EventEmitter`).
Implements mechanical quarantine and escalation for invariant violations. Every violation emits an immutable `AuditEvent`. Violations with `quarantine_behavior: 'fail-closed'` or `'quarantine'` auto-quarantine and route escalation to the `escalation_target` from the registry entry — without human action. No constructor options exist that could suppress quarantine (adversarial invariant).

New types exported: `QuarantineRecord`, `AuditEvent`, `EscalationNotice`, `QuarantineResult`, `QuarantineStatus`.

`packages/invariants/src/quarantine.test.ts` — adversarial test suite.
Covers: AuditEvent emission for every violation (including advisory), auto-quarantine for fail-closed and quarantine behaviors, escalation routing, QuarantineRecord shape, immutable result and payload, and the proof-artifact test (injected critical violation → auto-quarantine + AuditEvent, no human action).

`packages/invariants/src/index.ts` — updated to export `QuarantineManager` and all new types.

## Verification

| Check | Result |
|---|---|
| pnpm verify | PASS — env, lint, type-check, build, test, command checks all green (exit 0) |
| Quarantine unit tests | PASS — all new tests in quarantine.test.ts pass |
| pnpm test:db | PASS — 7/7 live-DB tests against Supabase zfzdnfwdarxucxtaojxm |
| R-level compliance | PASS — no R-level artifacts required for this diff |
| Lane authority | PASS — lane_type: governance; packages/invariants covered |

## Adversarial Tests Passed

- `QuarantineManager()` constructor accepts no suppression options — no config path to bypass quarantine
- `AUTO_QUARANTINE_BEHAVIORS` is a ReadonlySet — cannot be mutated at runtime
- Quarantine fires on repeated `process()` calls — no state degradation
- **Proof artifact:** injected critical violation (`INV-0009`, `quarantine_behavior: 'fail-closed'`) → `QuarantineRecord` created + `AuditEvent` emitted, no human action required
- `QuarantineResult` is frozen — cannot be mutated after `process()`
- `AuditEvent.payload` is frozen — cannot be mutated after creation

## pnpm test:db — Live DB

7/7 tests passed against Supabase project `zfzdnfwdarxucxtaojxm`:

- Submission and settlement persistence round-trip — PASS
- UTV2-920: invalid atomic enqueue → no lifecycle event or outbox row — PASS
- UTV2-920: invalid atomic delivery confirmation rollback — PASS
- UTV2-920: invalid atomic settlement → no rows written — PASS
- UTV2-883: no duplicate participants for same external_id and sport — PASS
- UTV2-996: re-settling creates correction row, not duplicate base — PASS
- UTV2-996: correction chain is additive, original row not mutated — PASS

## R-level compliance

```
Verdict: PASS
Changed files: 6
Rules matched: (none) — no R-level artifacts required for this diff
```

## Certification Impact

Runtime Certification — quarantine is now mechanical, not advisory. Critical invariant violations cannot reach production unnoticed.

## Maturity Impact

Stage 2 — INIT-1.3.3 complete. Unblocks UTV2-1094 (INIT-1.3.4 — Production and Replay Integration).
