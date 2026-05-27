# PROOF: UTV2-1178 — INIT-2.3.X Bypass Enforcement Runtime

Branch head SHA: 7fc6271ef49e8b5a466fc3be43c2b6d5f644eedd  
PR: https://github.com/griff843/Unit-Talk-v2/pull/888  
Tier: T1  
Cert blockers closed: CERT-BLK-002, CERT-BLK-003, CERT-BLK-005

---

## Summary

E-2 and G-6 bypass enforcement implemented in `packages/invariants/src/engine.ts`:

- **E-2**: `evaluate()` now emits `'unknown-evaluator-skipped'` `UnknownEvaluatorDiagnostic` (`replaySafe: true`) instead of silently continuing when an invariant in the registry has no evaluator function.
- **G-6**: New `validateGovernanceException()` method enforces exception expiration at use time — expired/rolled-back exceptions throw `GovernanceExceptionValidationError` and emit `'governance-exception-expired'`; active ones emit `'governance-exception-applied'` and return a replay-visible `GovernanceExceptionUseDiagnostic`.
- 10 adversarial tests cover all paths (4 E-2 + 6 G-6).
- `bypass-audit.md` updated with enforcement closure notes.

---

## Verification

### pnpm verify (exit 0)

```
> @unit-talk/v2@0.1.0 verify
> pnpm ops:sync-check && pnpm ops:system-alignment-check && pnpm ops:automation-coverage-check && pnpm env:check && pnpm lint && pnpm type-check && pnpm build && pnpm test && pnpm --filter @unit-talk/smart-form verify && pnpm verify:commands

[sync-check] OK (per-issue): branch "claude/utv2-1178-bypass-enforcement-runtime" <-> .ops/sync/UTV2-1178.yml
[system-alignment] verdict=PASS fail=0 warn=0
[automation-coverage] verdict=PASS fail=0 warn=0 classified=15
Environment files passed validation.
(lint) — PASS
(type-check) — PASS (tsc -b tsconfig.json exit 0)
(build) — PASS
(test) — all test suites PASS, 0 failures
(smart-form verify) — PASS
[command-manifest] Verified 14 command definition(s)
[check-migration-versions] 112 migration file(s) verified — no duplicate versions.
[lint-migrations] 112 migration file(s) checked — no findings.
```

### R-level compliance

```
Verdict: PASS
Changed files: 5
Rules matched: (none) — no R-level artifacts required for this diff
```

---

## Evidence

### pnpm test:db (exit 0 — live Supabase, project ref: zfzdnfwdarxucxtaojxm)

```
TAP version 13
# Subtest: audit_log is append-only (no UPDATE/DELETE)
ok 1 - audit_log is append-only (no UPDATE/DELETE)
# Subtest: settlement_records correction chain is additive
ok 2 - settlement_records correction chain is additive
# Subtest: pick_lifecycle events are immutable
ok 3 - pick_lifecycle events are immutable
# Subtest: UTV2-870: outbox row is in pending/processing/sent — no phantom states
ok 4 - UTV2-870: outbox row is in pending/processing/sent — no phantom states
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 25229.494768
```

### Adversarial tests — E-2 enforcement

```
# Subtest: emits unknown-evaluator-skipped event for invariant with no evaluator
ok 1 - emits unknown-evaluator-skipped event for invariant with no evaluator
# Subtest: unknown evaluator does not produce a violation entry
ok 2 - unknown evaluator does not produce a violation entry
# Subtest: emits one diagnostic per unknown-evaluator invariant
ok 3 - emits one diagnostic per unknown-evaluator invariant
# Subtest: known evaluator does not emit unknown-evaluator-skipped
ok 4 - known evaluator does not emit unknown-evaluator-skipped
```

### Adversarial tests — G-6 enforcement

```
# Subtest: active exception: emits governance-exception-applied and returns diagnostic
ok 1 - active exception: emits governance-exception-applied and returns diagnostic
# Subtest: expired exception (clock-based): emits governance-exception-expired and throws
ok 2 - expired exception (clock-based): emits governance-exception-expired and throws
# Subtest: rolled-back exception: throws and emits governance-exception-expired
ok 3 - rolled-back exception: throws and emits governance-exception-expired
# Subtest: explicitly expired status exception: throws and emits governance-exception-expired
ok 4 - explicitly expired status exception: throws and emits governance-exception-expired
# Subtest: active exception: does not emit governance-exception-expired
ok 5 - active exception: does not emit governance-exception-expired
# Subtest: validateGovernanceException accepts optional now parameter for deterministic testing
ok 6 - validateGovernanceException accepts optional now parameter for deterministic testing
```
