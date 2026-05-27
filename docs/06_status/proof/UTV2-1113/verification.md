# Verification: UTV2-1113

**Branch:** claude/utv2-1113-future-leakage-detector
**HEAD SHA:** 0b0aa477de6ab1d786f26f0faf24c02915ae5514
**Date:** 2026-05-27

## Summary

INIT-3.1.2 — Future-Leakage Detector. Adds a pure-domain `detectFutureLeakage` function to `packages/domain/src/scoring/`. Accepts a decision cutoff timestamp and a list of named feature evidence timestamps; returns `clean`, `leaked` (with field list), or `indeterminate` (fail-open when timestamps cannot be parsed). All logic is stateless with no I/O, no DB, no env reads. 12 unit tests pass; all existing suite tests (113) remain green; 7 live-DB smoke tests pass.

## Evidence

**Files changed:**
- `packages/domain/src/scoring/future-leakage-detector.ts` — FutureLeakageDetector implementation
- `packages/domain/src/scoring/future-leakage-detector.test.ts` — 12 node:test unit tests

**Assertions verified:**
- Clean when all field evidence predates cutoff
- Leaked when one field evidence postdates cutoff
- All post-cutoff fields reported in leaked result
- Clean with empty field_evidence list
- Exactly at cutoff is not leaked (boundary: same millisecond)
- 1ms after cutoff is leaked
- Indeterminate (fail-open) on invalid cutoff timestamp
- Indeterminate (fail-open) on invalid field evidence_at timestamp
- Deterministic: same input always returns same result
- Only leaked fields appear in result — clean fields excluded
- Far-future leakage detected (days after cutoff)
- Far-past evidence is clean (days before cutoff)
- Domain package remains pure: no I/O, no DB, no env reads

## Verification

### pnpm verify

Ran from worktree `/home/griff843/code/Unit-Talk-v2/.out/worktrees/claude__utv2-1113-future-leakage-detector`:

```
pnpm verify — PASS

> @unit-talk/v2@0.1.0 verify
> env:check && pnpm --filter '@unit-talk/*' --filter '!@unit-talk/discord-bot' build && pnpm lint && pnpm type-check && pnpm test && pnpm verify:commands

# tests 113
# suites 13
# pass 113
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 624.817786

[check-migration-versions] 112 migration file(s) verified — no duplicate versions.
[lint-migrations] 112 migration file(s) checked — no findings.
```

### pnpm test:db

```
pnpm test:db — PASS (7/7 live Supabase tests)

1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 25914.538844
```

### Future leakage detector tests (12/12)

```
npx tsx --test packages/domain/src/scoring/future-leakage-detector.test.ts

# tests 12
# suites 0
# pass 12
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 347.870426
```
