# PROOF: WORK-2026101604

MERGE_SHA: 3afaa0fa3858ec9b7aa75b3f24c8db47ee20472f

Issue: WORK-2026101604
Tier: T1
Implementation source SHA: `a22bfd76fb2101fa40adfb88f9bd411d3550eb81`
Result: static PASS; writable staging DB proof BLOCKED/DEFERRED as authorized by the lane precondition

## Verification

ASSERTIONS:

- [x] Picks are never graded from a fallback, time-distance ranking, time window, or tie.
- [x] Eligible participant-linked candidates are restricted to the pick sport.
- [x] Explicit event id, exact normalized event name, and unique-link-only selection fail closed with distinct reasons.
- [x] Identity failures do not contribute to stale-data counters or degraded-stale-input classification.
- [x] Each skipped pick is observable in existing run details up to a 100-entry cap, with exact overflow count.
- [x] Null-event WNBA and NCAAF shapes are classified and never settled.
- [x] Zero eligible participant-linked candidates report `event_link_not_found`, including named, explicit-id, WNBA and NCAAF fixtures; mismatch reasons are reserved for conflicts against an eligible candidate set.
- [x] Participant-forbidden game totals use canonical event id + exact name (when supplied) + sport as their authorized event-scoped identity and reject wrong ids, cross-sport ids, and conflicting name/id pairs without participant linkage.
- [x] Existing Track Only containment, CLV, provider, delivery, kill-switch, and manual-settlement behavior remains under the passing regression suite.

EVIDENCE:

## Focused issue suite

Command:

```text
pnpm exec tsx --test 'apps/api/src/grading-service.test.ts'
```

Measured final output:

```text
1..114
# tests 117
# suites 0
# pass 117
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1651.923132
```

The suite includes load-bearing tests for wrong/correct explicit id, cross-sport same-name exclusion, same-name ambiguity, distinct-name selection independent of time, name mismatch without fallback, one/multiple unnamed linked candidates, near/far time independence, null-event WNBA/NCAAF missing-link skips, stale-health separation, per-pick evidence, truncation, and the participant-forbidden game-total wrong-id/cross-sport/conflicting-name/accepted-identity matrix.

## Mutation evidence

```text
Mutant: choose first candidate before identity checks
Targeted result: tests 4; pass 1; fail 3
Observed failures: explicit eventId mismatch, unique exact-name selection, multiple unnamed candidates

Mutant: remove eventMatchesPickSport predicate
Targeted result: tests 1; pass 0; fail 1
Observed failure: cross-sport same-name candidate exclusion

Mutant: change evidence-cap comparison from < to <=
Targeted result: tests 1; pass 0; fail 1
Observed diagnostic: 101 !== 100
```

```text
Mutant: classify zero eligible links as event_id_mismatch
Targeted result: tests 2; pass 0; fail 2
Observed failures: ordinary no-link and explicit-id/name missing-link precedence

Mutant: fall back to the sole named event after a wrong explicit game-line id
Targeted result: tests 1; pass 0; fail 1
Observed diagnostic: graded 1 !== expected 0

Mutant: bypass exact-name consistency when a game-line eventId is present
Targeted result: tests 1; pass 0; fail 1
Observed diagnostic: graded 1 !== expected 0

Mutant: remove same-sport filtering from game-line named candidates
Targeted result: tests 1; pass 0; fail 1
Observed diagnostic: graded 1 !== expected 0
```

All mutants were removed before the final 117/117 focused run.

## Static verification

Command: `pnpm verify:static`

Result: exit 0. Measured stages included:

```text
[db-client-boundary] OK
[system-alignment] verdict=PASS fail=0 warn=0
[automation-coverage] verdict=PASS fail=0 warn=1 classified=15
Environment files passed validation.
lint: PASS
type-check: PASS
build: PASS
test: PASS
test:production-post-migration: 14 pass, 0 fail
smart-form verify: 211 pass, 0 fail; browser E2E not requested
[command-manifest] Verified 14 command definition(s)
[check-migration-versions] 139 migration file(s) verified
[lint-migrations] 138 migration file(s) checked — no findings
```

The automation warning is the repository baseline `WIRING_GLOB_SHADOWED` for `apps/qa-agent/src/**/*.test.ts`; the guard reported `baselined=119 new=0`.

## Canonical verification and writable DB disposition

Command: `pnpm verify`

The full static phase again passed. The command then invoked `test:live-db -> test:db` and the staging target guard refused before opening a writable database:

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
Command failed with exit code 1.
```

Disposition required by the lane packet: writable live-DB proof is blocked/deferred to the protected `staging-ci` GitHub environment. No production access, database write, or database mutation occurred locally.

## R-level check

Command: `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`

Earlier measurement (preserved, superseded): taken on implementation commit `a22bfd76fb2101fa40adfb88f9bd411d3550eb81` against a stale `origin/main`, so it counted files that were not part of this lane's diff. It does not describe the current PR diff.

```text
Verdict: PASS
Changed files: 16
Rules matched: discord-delivery
```

Current measurement after resync, on head `5e1d295e95caf6da16f46b694a5c8bf3d200272d` (merge of current `origin/main`), genuine output:

```text
Verdict: PASS
Changed files: 8
Rules matched: (none) — no R-level artifacts required for this diff
```

## Merge SHA Binding

Merge SHA: `3afaa0fa3858ec9b7aa75b3f24c8db47ee20472f`
PR: https://github.com/griff843/Unit-Talk-v2/pull/1768
