# PROOF: UTV2-1868

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-09T09:57:02.457Z
Issue: UTV2-1868
Tier: T2
Lane type: runtime
Branch: claude/utv2-1868-game-line-result-side
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1546
Head SHA: 2af53643c07b6e815a19c3443f4e754be02631be
result: pass

## ASSERTIONS:

- [x] A game-line scored market whose provider entity is `home` or `away` resolves to the corresponding canonical team participant and inserts a `game_results` row carrying that `participant_id` — a completed event yields **two** rows, one per side. (`UTV2-1868: home and away game-line scores land on distinct participants`)
- [x] A genuine placeholder (`all`) still resolves to `null` and still inserts an unattributed row; player props and game totals are unchanged. (`resolveAndInsertResults inserts game-line result with null participant_id`, `…deduplicates game-line results`, and `sideOf('points-all-game-ou-over') === null`)
- [x] A test fails if the side is dropped again. Mutation-checked in both directions and on the fallback — see the mutation table below.
- [x] An unresolvable team side is skipped and counted under its own `skippedTeamSideUnresolved`, never written participant-less. (`UTV2-1868: an unresolvable team side is skipped and counted, never written participant-less`)
- [x] Nothing reinterprets the ~280 existing ambiguous rows per family. This changes future writes only; no migration, no backfill, no write against production.
- [x] No containment change, no provider activation, no delivery change.

## EVIDENCE:

```
$ pnpm type-check
> pnpm exec tsc -b tsconfig.json
TYPECHECK_EXIT=0

$ pnpm test
(100 test files, node:test + tsx --test)
# fail 0   in every file
TEST_EXIT=0

$ pnpm exec tsx --test apps/ingestor/src/ingestor.test.ts
# tests 93
# pass 93
# fail 0

$ pnpm exec tsx --test apps/ingestor/src/results-resolver.test.ts
# tests 4
# pass 4
# fail 0

$ pnpm exec eslint apps/ingestor/src/sgo-fetcher.ts apps/ingestor/src/results-resolver.ts \
    apps/ingestor/src/ingestor.test.ts apps/ingestor/src/results-resolver.test.ts
(no output — clean)

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 6
Rules matched: ingestor-provider

$ pnpm verify
not run locally — `ci:assert-staging-target` fails closed outside CI by design.
`verify` is a required check and runs on this PR's head in CI.
```

## Verification
- [x] `pnpm type-check`: exit 0
- [x] `pnpm test`: exit 0, 100 test files, zero failures
- [ ] `pnpm verify`: not runnable locally (`ci:assert-staging-target` fails closed outside CI); asserted by the required `verify` check on this PR's head
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: Verdict PASS, rules matched `ingestor-provider`

## Mutation testing

Each mutation was applied alone, the suite re-run, and the mutation reverted. A repair whose
controls do not fail on the condition they name is not a repair.

| # | Mutation | Result |
|---|---|---|
| 1 | `sgo-fetcher.ts`: never capture a side (`providerSide = null` at both extraction sites) | `not ok 64 — the fetcher carries the home/away stat entity as providerSide`; 92 pass / 1 fail |
| 2 | `results-resolver.ts`: ignore `providerSide` (always write `participantId: null`) | `not ok 62 — home and away game-line scores land on distinct participants`, `not ok 63 — an unresolvable team side is skipped and counted`; 91 pass / 2 fail |
| 3 | `sgo-fetcher.ts`: remove the `sideId` fallback | `not ok 64 — the fetcher carries the home/away stat entity as providerSide`; 92 pass / 1 fail |

Mutations 1 and 3 fail a fetcher-level test and no resolver test; mutation 2 fails the two
resolver tests and no fetcher test. The two halves of the repair are therefore independently
constrained rather than jointly covered by one assertion.

## Runtime Verification

No runtime execution against a provider or a live database was performed, and none is claimed.
`SYNDICATE_MACHINE_MODE` is `parked`, provider ingestion is not activated, and this lane requests
no containment change. The defect was established from **read-only production SQL** rather than
from a run:

```
market_key               rows  with_participant  events  max_rows_per_event
points-all-game-ml        280                 0     280                   1
points-all-game-sp        280                 0     280                   1
points-all-reg-ml3way     280                 0     280                   1
game_total_ou             280                 0     280                   1
points-all-1h-ml          257                 0     257                   1
points-all-1h-ou          258                 0     258                   1
```

On a single event `game_total_ou = 13` while `points-all-game-ml = points-all-game-sp = 9`, and
`points-all-1h-ou = 8` while `points-all-1h-ml = points-all-1h-sp = 5`. Since 13 = 9 + 4 and
8 = 5 + 3, the stored game-line value is one team's score and the other team's is absent.

`game_results_game_line_unique_idx` is `UNIQUE (event_id, market_key, source) WHERE participant_id
IS NULL`, and `DatabaseGradeResultRepository.insert`
(`packages/db/src/runtime-repositories.ts:4763`) swallows the resulting 23505 and returns the
pre-existing row — so the discarded second write was counted as `insertedResults`. That is why the
loss is invisible in the ingestor's own telemetry and had to be measured in the table.

Dry-run behaviour is unchanged and correct: `dry-run-repositories.ts` intercepts
`eventParticipants.upsert` and passes `listByEvent` through to the real repository, so a dry run
over a not-yet-persisted event resolves no side and records `skippedTeamSideUnresolved` rather
than writing anything — the fail-closed direction.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1546
Approved PR head: pending merge
Execution SHA: 2af53643c07b6e815a19c3443f4e754be02631be
