# Verification: UTV2-1117 — SHA Verification at Inference (INIT-3.2.2)

**Tier:** T1
**Verifier:** claude-sonnet-4-6 (orchestrator)
**Implementation SHA:** 90865372f3ac149f3f008ac66bdb9eba9966e035
**Date:** 2026-05-27

## Summary

Implements `verifyShaAtInference()` — a pure domain function that checks whether the observed model artifact SHA at inference time matches the SHA recorded at registration. Fail-open policy for legacy models with no recorded SHA (→ `unverifiable`). No I/O, no DB, no env reads.

## Verification

### Static Verification (pnpm verify)

```
✓ pnpm verify — PASS
  tests: 113 pass, 0 fail
  type-check: PASS
  lint: PASS
  build: PASS
```

### Unit Tests (sha-verification.test.ts — 10 tests)

All 10 tests pass:
- verified when observed SHA matches expected
- mismatch when observed SHA differs from expected
- mismatch when observed SHA is null but expected is set
- unverifiable (fail-open) when expected SHA is null
- unverifiable (fail-open) when expected SHA is undefined
- unverifiable when both SHAs are null
- model_name and model_version carried through
- verified_at_ms preserved in result
- deterministic: same input always returns same result
- mismatch when observed SHA is empty string

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
  duration_ms: 35338
  supabase_project: zfzdnfwdarxucxtaojxm
```

Live Supabase run confirms no regressions in DB-integrated tests. This is a domain-only lane; test:db verifies the surrounding suite is healthy.

## Domain Purity

`packages/domain` invariant satisfied: `sha-verification.ts` has zero imports from `@unit-talk/db`, zero HTTP calls, zero `process.env` reads. The module imports nothing; it exports pure types and a deterministic function.
