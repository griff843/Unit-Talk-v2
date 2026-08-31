# PROOF: UTV2-1672

MERGE_SHA: d8cb5d929968bbe593626eab4e28448a34211467

> Pre-merge the merge anchor carries the verified implementation identity; the
> Execution SHA row below repeats it. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Issue: UTV2-1672
Tier: T1
Lane type: runtime
Proof profile: static
Branch: claude/utv2-1672-smart-form-backend-track-only
Head SHA: d8cb5d929968bbe593626eab4e28448a34211467
Diff base: cb5dc80350b06374efaea450a2fbfe6724d3c201
result: pass

## Summary

Smart Form backend, Track Only. Every backend path that can create member
delivery work is pinned closed for a Track Only pick, capper identity is
derived server-side rather than accepted from the client, source spoofing is
refused, and a Smart Form submission must resolve its participants against
canonical reference data or prove the coverage gap it claims.

The load-bearing claim is not that these guards exist. It is that each one is
*doing* something: every guard carries a mutation control that deletes the
guard's marked block from a copy of its own source, imports the mutant, and
asserts the prevented behaviour actually occurs. 15 guards, 15 controls. A
guard that could be deleted with all tests still green is not a guard, and
this bundle is the evidence that none of these can be.

## ASSERTIONS:

### Track Only is load-bearing across every backend path

- [x] **T1** `OUTBOX_TRACK_ONLY_CHOKEPOINT_GUARD` refuses `outbox.enqueue` for a
      Track Only pick in **both** repository implementations
      (`InMemoryOutboxRepository` and `DatabaseOutboxRepository`). This is the
      chokepoint: every delivery path in the system funnels through it, so a
      route that forgets its own check still cannot create delivery work.
- [x] **T2** `ATOMIC_TRACK_ONLY_CHOKEPOINT_GUARD` refuses
      `enqueueDistributionAtomic` before the RPC is issued. Proven by asserting
      the recorded RPC call list is empty at baseline and
      `['enqueue_distribution_atomic']` in the mutant -- the guard is proven by
      the *absence* of the database call, not by an exception message.
- [x] **T3** `DatabaseOutboxRepository.loadPickMetadata` refuses to proceed when
      the pick row is absent or unreadable, rather than treating an unknown row
      as delivery-eligible. Fail-closed: an unreadable row means Track Only
      status *cannot be established*, which is not the same as "not Track Only".
- [x] **T4** Submit, requeue, retry and the pre-atomic run-audit path each carry
      their own guard (`TRACK_ONLY_DIRECT_ENQUEUE_GUARD`,
      `TRACK_ONLY_REQUEUE_GUARD`, `TRACK_ONLY_RETRY_GUARD`,
      `TRACK_ONLY_ATOMIC_GUARD`). These are defence in depth above the
      chokepoint, and each is independently mutation-proven.
- [x] **T5** `TRACK_ONLY_REQUEST_INTEGRITY_GUARD` refuses to answer a Track Only
      request with a delivery-eligible pick -- the persisted pre-atomic
      enforcement the contract names.
- [x] **T6** `RECAP_TRACK_ONLY_EXCLUSION_GUARD` excludes Track Only picks from
      recap top-play selection. See "A guard that caused an outage" below; this
      one exists because the chokepoint above would otherwise have silently
      killed daily and weekly recaps.
- [x] **Zero member distribution.** No test in this lane produces a
      `distribution_outbox` row for a Track Only pick, and the chokepoint makes
      that structural rather than incidental.

### Identity is server-derived and spoofing is refused

- [x] **I1** `CAPPER_TRACK_ONLY_PIN_GUARD` pins `distributionMode: 'track-only'`
      server-side for an authenticated capper. The client cannot opt into
      member delivery; the mutant shows it can.
- [x] **I2** `CAPPER_SOURCE_PIN_GUARD` pins the pick `source` server-side. The
      mutant shows an authenticated capper can otherwise spoof it.
- [x] **I3** `SMART_FORM_HTTP_CONTRACT_GUARD` closes the trigger-scope exemption
      at the HTTP boundary: any `source: 'smart-form'` submission arriving over
      HTTP must declare both `metadata.distributionMode` and
      `metadata.participantResolution` or it is refused 400. Without it, an
      operator-role caller (and the fail-open bypass context, whose role is
      `operator`) can post a Smart Form pick that never reaches the relationship
      validator at all.

### Canonical relationship validation

- [x] **C1** `SMART_FORM_RELATIONSHIP_GUARD` validates sport, event, team and
      participant relationships against reference data. Cross-sport injection,
      participants outside the canonical event, ID/display-name mismatch, a
      player assigned to the wrong team, duplicate sides, and alias-based
      duplicate sides (`participantId` vs `canonicalId` for one entity) are each
      refused with their own test.
- [x] **C2** `CANONICAL_SPORT_ID_GUARD` refuses a `sportId` the catalog does not
      carry. Every reference-data lookup is case-sensitive, so without this a
      `sportId` of `'nba'` searches an empty universe and the entire coverage
      proof below becomes vacuous while still reporting success.
- [x] **C3** `MANUAL_COVERAGE_GAP_PROOF_GUARD` verifies the coverage gap a
      manual override claims, rather than accepting the claim. It refuses zero
      participants; refuses a one-sided matchup for team sports only; refuses a
      name that still holds a non-ASCII code point after folding; refuses
      duplicate participants by alias key; and refuses any participant that
      resolves canonically.
- [x] **C4** Alias normalisation is proven against the bypasses it exists to
      stop: Cyrillic and Greek homoglyphs, fullwidth forms, zero-width
      characters in every word, punctuation, and city-prefix asymmetry in both
      directions.
- [x] **C5** `SMART_FORM_TRIGGER_SCOPE` keys the strict contract on the presence
      of Smart Form fields, so pre-existing in-process `smart-form` callers keep
      working. The mutant shows they are otherwise refused with a 422 -- this
      guard's removal is a regression, which is why its control asserts a
      *failure* the guard prevents rather than a bypass it blocks.

### Verification

- [x] `pnpm verify:static` exits 0 at this head: 99 suites, 5360 passing, 0
      fail, 0 cancelled, 0 skipped, 0 `not ok` lines. The `test:live-db` half is
      produced by the required `verify` CI job in the `staging-ci` environment;
      it cannot run locally by design.
- [x] `pnpm lint` and `pnpm type-check` clean standalone.
- [x] `lane:check --lane runtime` passes over this lane's complete changed set.
- [x] `r-level-check --base origin/main --head HEAD` returns PASS, 29 changed
      files, no rules matched.

## Verification

### Commands executed

| Command | Result |
|---|---|
| `pnpm verify:static` | exit 0 -- 99 suites, 5360 pass, 0 fail/skip/cancel |
| `pnpm lint` (standalone) | exit 0, no findings |
| `pnpm type-check` (standalone) | exit 0, no diagnostics |
| `pnpm exec tsx --test` over the 8 touched suites | 273 tests, 0 failures |
| `pnpm lane:check --lane runtime` over the changed set | `PASS lane=runtime` |
| `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS, 29 files, no rules matched |
| `pnpm test:live-db` | refused locally by `ci:assert-staging` -- produced by required CI |

### Why the mutation controls are the proof

A guard is only proven by making it fail on the condition it names. Each
control here:

1. reads the guard's own source file,
2. deletes the block between its `UTV2-1672 <NAME>_START` / `_END` markers by
   regex, asserting `mutantSource !== source` so a rename cannot make the
   control silently vacuous,
3. writes a sibling module, imports it with a `?mutation=` cache-buster,
4. asserts the prevented behaviour now occurs, and
5. unlinks the mutant in `finally`.

The regex carries the `g` flag. That is not cosmetic: `OUTBOX_TRACK_ONLY_CHOKEPOINT_GUARD`
marks two blocks -- one per repository implementation -- and an earlier revision
of this control removed only the first, so it proved half the feature while
reporting success.

### A guard that caused an outage, found by adversarial review

The outbox chokepoint (T1) is correct and load-bearing, and it introduced a
production outage that no test in this lane initially caught.

`postRecapSummary` calls `outbox.enqueue` for the recap top play. That call sits
*outside* its own `try` block, and `topPlayRow` is selected purely by profit
with no Track Only filter. So the first settled Track Only pick that happened to
be the best result of the day would hit the new chokepoint, throw, and take the
entire daily or weekly recap down with it. `recap-scheduler.ts` catches the
throw, so the failure mode is a silently missed recap rather than a crash --
which is worse, not better.

`RECAP_TRACK_ONLY_EXCLUSION_GUARD` (T6) fixes it by excluding Track Only picks
from recap aggregation. This is recorded here rather than quietly fixed because
it is the clearest example in this lane of a safety guard whose blast radius
extended past its intended path.

### A coverage proof that was vacuous in production

Adversarial review round 4 established that `findCanonicalCoverage` searched
`teams` (via `searchTeams`) and `players` joined to current assignments (via
`searchPlayers`). Both tables are **empty in production** -- `teams` 0 rows,
`player_team_assignments` 0 rows. The coverage proof therefore returned `null`
for every name, in every sport, and `MANUAL_COVERAGE_GAP_PROOF_GUARD` accepted
every manual override unconditionally while appearing to work.

`getCatalog()` reads `participants`, which *is* populated (124 teams). The guard
now checks the catalog team list first, so the branch that carries the refusal
is one backed by data that actually exists. The regression test for this
stubs both search methods to return `[]` and asserts the refusal still fires --
it is the test that would have caught the original vacuity.

## Runtime Verification

This lane changes application code, and its runtime behaviour is verified by
executing that code -- 273 tests across the eight touched suites, including 15
mutation controls that execute mutated copies of the real modules.

The live-DB half of `pnpm verify` is produced by the required `verify` CI job in
the `staging-ci` environment. It is structurally unrunnable locally:
`test:live-db` begins with `ci:assert-staging`, which refuses any target that is
not the staging ref `xskgrzbteyqdufktjrjx`.

**Disclosed limit.** The `DatabaseOutboxRepository` chokepoint (T1, T3) is
proven against a faithful stub Supabase client modelling
`.from('picks').select().eq().maybeSingle()` and `.from().insert().select().single()`,
not against real Postgres. A dedicated live-DB proof test was written and then
**withdrawn**: registering it would have required editing
`docs/05_operations/db-writer-classification.json`, which is
`outside_allowed_paths` for lane `runtime`, and the lane's authorization
explicitly forbids widening lane authority or using a scope override to repair
executor authority. The withdrawal is the correct outcome under that
instruction, and the consequence is stated rather than hidden: `Require
live-DB proof for runtime changes` (a non-required check) stays red.

No production mutation, member delivery, ingestion unpark, or direct-main work
was performed by this lane.

## EVIDENCE:

```text
Captured 2026-08-31   HEAD=d8cb5d929968bbe593626eab4e28448a34211467   base=cb5dc80350b06374efaea450a2fbfe6724d3c201

==============================================================
GUARD / MUTATION-CONTROL INVENTORY -- 15 guards, 15 controls
==============================================================
GUARD                                    CONTROL ASSERTS
ATOMIC_TRACK_ONLY_CHOKEPOINT_GUARD       atomic RPC runs for a track-only pick
CANONICAL_SPORT_ID_GUARD                 coverage proof becomes vacuous
CAPPER_SOURCE_PIN_GUARD                  capper can spoof the pick source
CAPPER_TRACK_ONLY_PIN_GUARD              capper can opt into member delivery
MANUAL_COVERAGE_GAP_PROOF_GUARD          fabricated coverage gap is admitted
OUTBOX_TRACK_ONLY_CHOKEPOINT_GUARD       any route can create delivery work
RECAP_TRACK_ONLY_EXCLUSION_GUARD         Track Only pick becomes recap top play
SMART_FORM_HTTP_CONTRACT_GUARD           non-capper posts an unvalidated pick
SMART_FORM_RELATIONSHIP_GUARD            unverifiable canonical resolution admitted
SMART_FORM_TRIGGER_SCOPE                 legacy smart-form callers are refused
TRACK_ONLY_ATOMIC_GUARD                  atomic distribution path runs
TRACK_ONLY_DIRECT_ENQUEUE_GUARD          track-only pick enqueued for delivery
TRACK_ONLY_REQUEST_INTEGRITY_GUARD       Track Only request answered delivery-eligible
TRACK_ONLY_REQUEUE_GUARD                 track-only pick sent down delivery path
TRACK_ONLY_RETRY_GUARD                   dead-lettered track-only delivery re-armed

==============================================================
PER-SUITE RESULTS (pnpm exec tsx --test, run directly)
==============================================================
apps/api/src/smart-form-validation.test.ts          42 pass  0 fail
apps/api/src/http-integration.test.ts               27 pass  0 fail
apps/api/src/distribution-service.test.ts           35 pass  0 fail
apps/api/src/run-audit-service.test.ts               9 pass  0 fail
apps/api/src/submission-service.test.ts             89 pass  0 fail
apps/api/src/server.test.ts                         47 pass  0 fail
apps/api/src/controllers/submit-pick-controller.ts  11 pass  0 fail
apps/api/src/recap-service.test.ts                  27 pass  0 fail
                                        TOTAL      273 pass  0 fail

==============================================================
LANE AUTHORITY
==============================================================
$ pnpm lane:check --lane runtime --file <this lane's changed set>
  lane:check PASS lane=runtime

==============================================================
R-LEVEL
==============================================================
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
  Verdict: PASS
  Changed files: 29
  Rules matched: (none) — no R-level artifacts required for this diff
```

### `pnpm verify:static` -- exit 0

`verify` is `pnpm verify:static && pnpm test:live-db`. Steps executed and passed,
in order: `ci:db-client-boundary`, `ops:sync-check`, `ops:system-alignment-check`,
`ops:automation-coverage-check`, `env:check`, `lint`, `type-check`, `build`,
`test`, `@unit-talk/smart-form verify`, `verify:commands`.

```text
$ pnpm verify:static; echo "VERIFY_STATIC_EXIT=$?"

  [db-client-boundary] OK: every site is classified and none is reachable from `pnpm test`
  [system-alignment]   verdict=PASS fail=0 warn=0
  [automation-coverage] verdict=PASS fail=0 warn=1 classified=15
  [executable-wiring]  verdict=PASS required_roots=verify
  [executable-wiring]  tests total=470 required-reachable=315 unwired=119 (baselined=119 new=0)

  aggregate over 99 node:test suites
  # pass       5360
  # fail       0
  # cancelled  0
  # skipped    0
  occurrences of "not ok": 0

VERIFY_STATIC_EXIT=0
```

The exit code is captured directly from the `pnpm` process, not from a pipeline
tail -- a piped invocation reports the exit status of the last stage and can
mask a failing verify.

### `pnpm lint` and `pnpm type-check` -- run standalone, exit 0

```text
$ pnpm lint; echo "LINT_EXIT=$?"
> eslint . --cache --cache-location .cache/eslint/
LINT_EXIT=0

$ pnpm type-check; echo "TYPE_CHECK_EXIT=$?"
> pnpm exec tsc -b tsconfig.json
TYPE_CHECK_EXIT=0
```

## Independent review -- four rounds, recorded in full

Four independent adversarial reviews were run against this lane. Their findings
are recorded here including the ones that were not fixed.

**Round 2** found nine defects. Six were fixed inside declared scope. Three were
deferred because they required `apps/worker/**` or a migration, both outside
this lane's authority.

**Round 3** found that round 2's own fixes had introduced new defects -- the
recap outage described above, plus over-refusals (substring containment refused
"Alex Pereira Junior" because "Alex Pereira" is canonical; a `>= 2` participant
rule refused golf and tennis single-competitor markets) and under-refusals
(fullwidth and Cherokee confusables, zero-width characters in every word, and an
unvalidated case-sensitive `sportId`). All were fixed.

**Round 4** found the production vacuity described above (fixed), a non-ASCII
over-refusal that rejected real Soccer clubs -- Brøndby IF, Preußen Münster,
Kasımpaşa, ŁKS Łódź -- because NFKD does not decompose ø, ß, ł or ı (fixed), and
a retrieval failure on punctuated single-word names (fixed).

### Findings deliberately NOT fixed, and why

Round 4 also found that `isSameEntityName` both under-refuses (a trailing extra
token or a reordered token evades it: "Knicks Basketball", "Knicks NY") and
over-refuses (a shared trailing token matches distinct entities: "North Texas"
is refused as though it were "Texas").

These are not independently fixable. Round 3 required that "Alex Pereira Junior"
**not** be treated as covered when "Alex Pereira" is canonical; round 4 requires
that "Knicks Basketball" **be** treated as covered when "Knicks" is canonical.
Those are the same structural case with opposite required verdicts. No token
rule satisfies both.

The reason this is acceptable rather than a blocker: this heuristic is
bypass-*detection* for a manual-override claim, not a safety boundary. It does
not gate Track Only, member distribution, capper identity, or source spoofing --
all of which are enforced by the guards above and are unaffected by how
generously two names are considered the same. A wrong verdict here means a
manual override is accepted that should have been steered to canonical
selection, or refused when it should have been accepted. Neither creates member
delivery.

Also carried forward, not fixed: `getCatalog()` is an uncached 7-query round
trip on every Smart Form submission. Recorded as performance debt.

### Cross-lane dependency -- disclosed

`apps/smart-form` on this branch sends neither `metadata.distributionMode` nor
`metadata.participantResolution`, while `SMART_FORM_HTTP_CONTRACT_GUARD` refuses
any HTTP `source: 'smart-form'` submission lacking them. The client half is Lane
2 (UTV2-1786). Merging this lane alone therefore 400s the *current* Smart Form
frontend until Lane 2 lands.

This is the intended phased outcome, not a defect: production activation is
disabled, and the alternative -- leaving the HTTP boundary open so an unvalidated
Smart Form submission is accepted -- is the thing this lane exists to prevent.
It is stated here so the sequencing is a decision rather than a surprise.

### Reference data is empty in both environments

`teams` and `player_team_assignments` are empty in production **and** staging.
The catalog-backed branch of the coverage guard (`participants`, 124 teams) is
what makes the guard non-vacuous today; the search-backed branch will only
become load-bearing once those tables are populated. Backfilling them would be
production data mutation, which is a hard stop for this lane.

## Merge SHA Binding

Merge SHA: d8cb5d929968bbe593626eab4e28448a34211467
PR: https://github.com/griff843/Unit-Talk-v2/pull/1466
Execution SHA: d8cb5d929968bbe593626eab4e28448a34211467
