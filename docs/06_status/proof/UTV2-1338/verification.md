# Verification — UTV2-1338 Incident Runbook

## Verification

**Branch:** codex/utv2-1338-incident-runbook  
**Date:** 2026-06-28  
**Change type:** Docs-only — 3 new files added to `docs/06_status/proof/UTV2-1338/`

---

## pnpm type-check

**Result: PASS**

```
> @unit-talk/v2@0.1.0 type-check
> pnpm exec tsc -b tsconfig.json
(exit 0 — no output, no errors)
```

---

## pnpm test

**Result: PASS**

```
TAP version 13
...
# tests 19
# suites 0
# pass 19
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 714.15236
```

---

## pnpm verify (verify:static)

**Result: PASS** (static suite — env:check, lint, type-check, build, test, smart-form verify, commands)

```
> @unit-talk/v2@0.1.0 verify:static
> pnpm ops:sync-check && pnpm ops:system-alignment-check && pnpm ops:automation-coverage-check
  && pnpm env:check && pnpm lint && pnpm type-check && pnpm build && pnpm test
  && pnpm --filter @unit-talk/smart-form verify && pnpm verify:commands

[command-manifest] Verified 14 command definition(s)
[check-migration-versions] 1 migration file(s) verified — no duplicate versions.
[lint-migrations] No migration files to lint.
(exit 0)
```

Note: `pnpm verify` (full) = `verify:static && test:live-db`. The live-db component (`pnpm test:db`) hit a pre-existing Supabase `statement_timeout` on `listByLifecycleStates` (unrelated to this docs-only lane — no source code changed). See test:db section below.

---

## pnpm test:db

**Result: FAIL — pre-existing Supabase statement_timeout (not caused by this change)**

```
TAP version 13
not ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
  error: 'Failed to list picks by lifecycle states: canceling statement due to statement timeout'
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
not ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
  error: 'Failed to list picks by lifecycle states: canceling statement due to statement timeout'
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated

# tests 7
# suites 0
# pass 5
# fail 2
# cancelled 0
# skipped 0
# todo 0
# duration_ms 347520.559873
```

**Root cause of failures:** `listByLifecycleStates` is timing out in Supabase. This is a live-DB infrastructure issue. The two failing tests (1, 4) both hit the `promotion-service → listByLifecycleStates` path with a `statement_timeout` error. This is unrelated to the UTV2-1338 docs-only change — no source code was modified. The failure pattern matches the known Supabase DB degradation tracked in §2 of the runbook (DB timeout incident class).

---

## r-level-check

**Result: PASS**

```
Verdict: PASS
Changed files: 2
Rules matched: (none) — no R-level artifacts required for this diff
```

---

## Merge SHA

Merge SHA: pending (auto-bound post-merge by post-merge-lane-close.yml)
