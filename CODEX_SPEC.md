# Codex Spec: UTV2-610 — High-risk verification package tests

## Issue
UTV2-610: Audit prerequisite: add high-risk tests for the verification package and other undercovered gate logic

## Branch
`griffadavi/utv2-610-verification-tests`

## Tier
T2

## Context
Claude's audit identified thin coverage in `packages/verification` gate and control-plane logic. False PASS states from under-tested gate code would undermine all readiness claims. This is pure test writing — no runtime logic changes, no new features.

## Scope (write only — do NOT modify implementation files)

### Primary targets (add tests where missing or thin):

1. **`packages/verification/src/engine/determinism-validator.ts`**
   - Threshold boundary conditions (at-limit, just-above, just-below)
   - Score divergence edge cases that should produce FAIL
   - False-positive scenario: two nearly-identical runs that should still PASS

2. **`packages/verification/src/engine/fault/assertion-engine.ts`**
   - Failure mode: assertion with no expectations registered
   - Failure mode: partial assertion (some pass, some fail)
   - Edge case: empty fault injection produces no assertion violations

3. **`packages/verification/src/engine/fault/fault-orchestrator.ts`**
   - Failure mode: fault injection triggers before any picks are processed
   - Recovery case: orchestrator continues after single fault injection

4. **`packages/verification/src/engine/event-store.ts`**
   - Boundary: storing and retrieving zero events
   - Boundary: event order preserved under concurrent writes (if applicable)

5. **`packages/verification/src/scenarios/registry.ts`** (extend existing test)
   - Duplicate scenario registration should throw or be idempotent (not silent)
   - Missing scenario lookup returns null/throws — not undefined behavior

### Test file naming convention
Add tests alongside source files: `*.test.ts` in the same directory.

### Test framework
Use `node:test` + `assert` (same as existing tests in this package — check `determinism-gate.test.ts` and `fault-injection.test.ts` for the pattern).

## Acceptance criteria
- All newly added test files pass under `pnpm test:verification`
- Full `pnpm verify` passes (type-check + lint + build + all tests)
- Record which scenarios are newly covered in a `docs/06_status/proof/UTV2-610/diff-summary.md`

## Proof required
- `docs/06_status/proof/UTV2-610/diff-summary.md` — list of newly covered scenarios
- `docs/06_status/proof/UTV2-610/verification.log` — tail of `pnpm verify` output showing green

## sync.yml
Create `.ops/sync.yml`:
```yaml
version: 1
approval:
  allow_multiple_issues: false
  skip_sync_required: false
entities:
  issues:
    - UTV2-610
```

## Do NOT
- Modify any implementation files in `packages/verification/src`
- Add new exports to `packages/verification/src/index.ts`
- Touch any other package or app
