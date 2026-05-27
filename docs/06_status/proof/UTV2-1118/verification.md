# Verification: UTV2-1118 — Real Shadow Inference (INIT-3.2.3)

**Tier:** T1
**Verifier:** claude-sonnet-4-6 (orchestrator)
**Implementation SHA:** dcb1de705172f9259a779b472660441385fe1b12
**Date:** 2026-05-27

## Summary

Implements `buildShadowInferenceResult()` — a pure domain function that records
shadow model outputs independently from the production routing path. Shadow scores
never feed back into production decisions. Divergence detection flags when shadow
and production scores differ beyond threshold (default 1%).

## Verification

### Static Verification (pnpm verify)

```
✓ pnpm verify — PASS
  tests: 113 pass, 0 fail
  type-check: PASS
  lint: PASS
  build: PASS
```

### Unit Tests (shadow-inference.test.ts — 11 tests)

All 11 tests pass:
- completed status when shadow_score is set and no error
- failed status when error_message is set
- skipped status when shadow_score is null with no error
- diverged=true when delta exceeds default threshold (1%)
- diverged=false when delta is within threshold
- custom divergence_threshold respected
- diverged=false when both scores are null
- artifact_sha null when undefined provided
- all fields passed through
- deterministic: same input always returns same result
- shadow result does not mutate input
- domain package purity: no I/O, no DB, no env reads

### R-Level Check

```
Verdict: PASS
Changed files: 2
Rules matched: (none) — no R-level artifacts required for this diff
```

### Runtime Verification (pnpm test:db)

```
pnpm test:db — PASS
  tests: 7 pass, 0 fail
  duration_ms: 24515
  supabase_project: zfzdnfwdarxucxtaojxm
```

### Adversarial Validation

Shadow inference isolation is enforced by the function's type contract:
`buildShadowInferenceResult()` returns a `ShadowInferenceResult` value object.
It accepts no production state as output targets, has no side effects, and
takes no callbacks. A caller cannot route the shadow output to production
without explicitly extracting `shadow_score` and passing it to a separate
production path — there is no implicit coupling.

Divergence detection is defensive: `diverged: true` flags but does not block.
Blocking decisions remain with the caller (promotion gate, calibration gate).

## Domain Purity

`shadow-inference.ts` has zero imports from `@unit-talk/db`, zero HTTP calls,
zero `process.env` reads. The module is a pure computation: inputs in, result out.
