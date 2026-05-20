# UTV2-1018 Verification — Fix promotion eval outside atomic block

## Static Verification

```
pnpm verify: PASS
- ops:sync-check: PASS
- system-alignment-check: PASS
- automation-coverage-check: PASS
- env:check: PASS
- lint: PASS
- type-check: PASS
- build: PASS
- test (113/113): PASS
- verify:commands: PASS
```

## R-Level Compliance

```
Verdict: PASS
Changed files: 2
Rules matched: (none) — no R-level artifacts required for this diff
```

## Live-DB Proof

```
pnpm test:db (7/7): PASS
```

## T1 Proof Tests (4/4 PASS)

```
UNIT_TALK_APP_ENV=local npx tsx --test apps/api/src/t1-proof-utv2-1018-stranded-picks.test.ts

ok 1 - UTV2-1018: submitted pick completes promotion eval with no stranded row
ok 2 - UTV2-1018: detectStrandedPicks returns PickRecord array with correct shape
ok 3 - UTV2-1018: auditStrandedPicks writes audit records for detected stranded picks
ok 4 - UTV2-1018: picks table has promotion_target column (schema invariant)

# tests 4 / pass 4 / fail 0
```

## Live Database Observation

detectStrandedPicks() found 196 existing stranded picks in the live database (picks in validated state older than 5 minutes with promotion_target = null), confirming the bug predated this fix.

Branch HEAD SHA: e8b67dd3869a5a826c60c4c050bb59157308998d
Scope-widening commit SHA: aa661371529cf1648c5c3a37f6c919f622046b78

## Verification

All pre-merge checks passed. pnpm verify green (113/113). pnpm test:db green (7/7). T1 proof green (4/4). R-level PASS. Scope widened to include reconciler, test, proof, and lane infrastructure files. PM_VERDICT received and t1-approved label applied.
