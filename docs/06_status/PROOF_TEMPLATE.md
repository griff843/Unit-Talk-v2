# Proof Template — T1 Sprints

> Reusable template for T1 (high-risk) sprint proof capture.
> Copy this template into `out/sprints/<SPRINT>/<DATE>/` and fill in.
> For T2/T3 sprints, proof is captured in the commit message and test results.

## Sprint

- **Name:** `SPRINT-<NAME>`
- **Tier:** T1
- **Date:** YYYY-MM-DD
- **Objective:** <one line>

## Pre-Implementation State

```
git rev-parse HEAD: <commit hash>
pnpm test: <count>/<count> passing
pnpm type-check: PASS/FAIL
```

## Post-Implementation Verification

```
pnpm verify output:
  env-check: PASS/FAIL
  lint: PASS/FAIL
  type-check: PASS/FAIL
  build: PASS/FAIL
  test: <count>/<count> passing
```

## Lifecycle Gate (if unified_picks touched)

```
npm run lifecycle:single-writer -- --strict
  Files scanned: <N>
  Violations found: 0
  GATE: PASS/FAIL
```

## Independent Verification

| Check | Result | Evidence |
|-------|--------|----------|
| <check 1> | PASS/FAIL | <how verified> |
| <check 2> | PASS/FAIL | <how verified> |

## Rollback Readiness

- Rollback plan documented: YES/NO
- Rollback tested: YES/NO
- Rollback command: `<command or reference>`

## Verdict

- **Sprint status:** PASS / FAIL
- **Test delta:** <old count> -> <new count>
- **Regressions:** 0 / <describe>
