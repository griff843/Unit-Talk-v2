# PROOF: WORK-2026101601

MERGE_SHA: pending merge

Issue: WORK-2026101601<br>
Tier: T1<br>
Lane type: runtime<br>
Execution SHA: `052d64ff5c5f0db57410a902a859d6e5792a7610`<br>
PR: pending<br>
result: local_static_pass_staging_deferred

## ASSERTIONS:

- [x] A named pick with no matching candidate name is skipped as `event_name_mismatch`; unrelated candidates are never used as a fallback.
- [x] Equidistant candidates and candidates within the six-hour ambiguity window are skipped as `event_match_ambiguous`.
- [x] A nearest candidate more than 36 hours from the reference time is skipped as `event_time_mismatch`.
- [x] Both event-resolution callers propagate classified selection failures.
- [x] WNBA and NCAAF Track Only-style picks with `eventId: null` and no event link remain unsettled with a classified skip reason.
- [x] A unique candidate and an exact name match among multiple candidates continue to grade.
- [x] Per-pick skip evidence is stored in existing grading-run details, capped at 100 entries, with an exact truncation count.
- [x] Existing skip-reason and run-detail keys are unchanged; new keys and reasons are additive.

## EVIDENCE:

Focused suite on the implementation SHA:

```text
1..106
# tests 109
# suites 0
# pass 109
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Mutation checks were performed by temporarily removing each guard, running the directly affected test, observing failure, restoring the implementation, and rerunning the complete focused suite:

```text
name fallback restored: 1 targeted failure (graded=1, expected 0)
ambiguity guard disabled: 3 targeted failures (each graded=1, expected 0)
36-hour bound removed: 1 targeted failure (historical-mismatch reason, expected event_time_mismatch)
evidence cap removed: 1 targeted failure (101 entries, expected 100)
restored implementation: 109 pass, 0 fail
```

Static gate result:

```text
[automation-coverage] PASS fail=0 warn=1 classified=15
[command-manifest] Verified 14 script command references across 2 registry files.
[check-migration-versions] 139 migration files checked; no duplicate version prefixes.
[lint-migrations] 138 migration files checked; no findings.
pnpm verify:static: exit 0
```

The automation warning was the repository's baselined QA glob-shadow classification; it was not introduced or changed by this lane.

R-level and scope results:

```text
Verdict: PASS
Changed files: 6
Rules matched: (none) — no R-level artifacts required for this diff

scope-diff verdict=clean
changed: 2 declared_scope: 2
```

## Verification

- [x] `pnpm exec tsx --test 'apps/api/src/grading-service.test.ts'`: 109 pass, 0 fail.
- [x] Mutation checks for fallback, ambiguity, distance bound, and evidence cap: every targeted test failed when its guard was removed; full suite passed after restoration.
- [x] `pnpm verify:static`: exit 0, including lint, type-check, build, root tests, Smart Form verification, command-manifest checks, and migration checks.
- [ ] `pnpm verify`: executed in full; its complete `verify:static` phase passed, then `test:live-db` exited 1 at the same staging-target identity guard before any DB test or write. Protected staging CI is required to turn this gate green.
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS; 6 changed files at the implementation-proof scaffold head; no rules matched.
- [x] `pnpm ops:scope-diff -- --issue WORK-2026101601`: clean; both implementation files are in declared scope.
- [ ] `pnpm test:db`: executed locally and refused before any write because the target resolved to `host=127.0.0.1 ref=unidentified`, not staging ref `xskgrzbteyqdufktjrjx`.
- [ ] Protected staging-CI writable DB proof and exact-head receipts: pending draft PR publication.
- [ ] PM approval, governed merge, lane finalization, and post-merge reconciliation: explicitly post-executor; not claimed.

Local DB refusal (exit 1):

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
```

No deployment, production access, production write, migration, or admin path was used.

## Merge SHA Binding

Merge SHA: pending merge<br>
PR: pending<br>
Execution SHA: `052d64ff5c5f0db57410a902a859d6e5792a7610`
