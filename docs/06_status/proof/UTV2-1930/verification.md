# PROOF: UTV2-1930

MERGE_SHA: 17b3f964fb04faa4060fa43fc095531a4f8e8942

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-18T07:46:46.000Z
Issue: UTV2-1930
Tier: T2
Lane type: runtime
Branch: claude/utv2-1930-operator-event-seeding
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1602
Head SHA: 4b7957935c657b82b4394485a1858357d364a5f1
result: pass

## ASSERTIONS:

- [x] An operator can create a current, pickable event without raw SQL and without unparking the ingestor.
- [x] The event identity is deterministic, so re-running the same seed updates one row instead of accumulating near-duplicates a capper would then have to choose between.
- [x] The event and BOTH `event_participants` rows are written together, so the "teams": [] shape that the hand-seeded canary exhibits is not reachable through this path.
- [x] Every participant is resolved against the canonical catalog before any write; an unknown one is refused by name and never minted.
- [x] A provider-ingested event is never overwritten by operator-asserted metadata.
- [x] Provenance is truthful: `source: operator-manual-entry`, `providerIngested: false`, and the seeding operator recorded verbatim.
- [x] The tool does NOT make an operator-seeded event gradeable, and does not touch containment, provider activation, ingestion or delivery.
- [x] Writing is opt-in behind `--apply`; the default path resolves, reports and writes nothing.

## The defect this closes, measured in production

Production `zfzdnfwdarxucxtaojxm`, 2026-09-18, against the hand-seeded canary event
`16924899-2a8c-4f90-9c0c-1f45e3230d79` ("Lions @ Bills", 2026-09-17):

| | hand-seeded canary | all 19 provider-ingested events in the same window |
|---|---|---|
| `external_id` | NULL | present |
| `event_participants` rows | 0 | exactly 2 |

A NULL `external_id` leaves the row with no stable identity, so a re-seed could only
ever have created a second row beside it. Zero participant rows means
`/api/reference-data/matchups` returns it with `"teams": []` and no side is pickable.

## EVIDENCE:

Measured on this branch at 4b7957935c657b82b4394485a1858357d364a5f1.

```
$ pnpm type-check
> pnpm exec tsc -b tsconfig.json
TYPECHECK_EXIT=0

$ pnpm lint
> eslint . --cache --cache-location .cache/eslint/
LINT_EXIT=0

$ pnpm test
# tests 6527
# pass  6527
# fail  0
TEST_EXIT=0

$ pnpm exec tsx --test scripts/ops/seed-operator-event.test.ts
# tests 13
# pass  13
# fail  0

$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 5
Rules matched: (none) - no R-level artifacts required for this diff

$ pnpm verify
Runs on CI for this PR. It cannot exit 0 in this local worktree because
ci:assert-staging-env requires the CI-only staging credentials; the four commands
above are its constituent local steps and all exit 0.
```

## Verification
- [x] `pnpm type-check`: exit 0
- [x] `pnpm test`: exit 0 - 6527 tests, 6527 pass, 0 fail
- [x] `pnpm verify`: delegated to CI on PR #1602 (see EVIDENCE above for why it cannot run locally)
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS, no artifacts required

## Mutation controls

Each control was removed in turn, the suite re-run, and the source restored
byte-identical afterwards (verified with `diff`). A control that fires no test is
not a control.

| Mutation | Tests that failed |
|---|---|
| `assertNotProviderOwned` neutered (`if (existing) return`) | 6, 9, 10, 11 |
| away `event_participants` row not written | 10, 11 |
| null `external_id` tolerated (`?? 'UNKNOWN'`) | 5 |

Two of the 13 tests found real defects in the first draft rather than confirming it:
a fixture helper coalesced an explicit `null` away, making one assertion vacuous; and
`createInMemoryRepositoryBundle()` always seeds team fixtures, so the `catalog_empty`
branch was unreachable and that test was silently exercising `participant_not_found`.
Both are fixed and both now fail when their control is removed.

## Runtime Verification

**No production write was performed by this lane, deliberately.**
`docs/05_operations/DB_ENVIRONMENT_OPERATOR_POLICY.md` (RATIFIED) sets production agent
write access to "No - operator only". This lane therefore ships the governed path and
not an execution of it.

The smallest operator action that exercises it end to end, with a non-secret success
criterion:

```
# 1. Dry run - resolves, prints the plan, writes nothing.
pnpm exec tsx scripts/ops/seed-operator-event.ts \
  --sport NFL --date 2026-09-21 --starts-at 2026-09-21T17:00:00Z \
  --home BUFFALO_BILLS_NFL --away MIAMI_DOLPHINS_NFL --operator griff843

# 2. Same command with --apply once the plan reads correctly.
```

Success criterion, neither of which requires reading a secret:

1. The dry run prints `"applied": false` and an `externalId` of the form
   `operator-manual:NFL:2026-09-21:MIAMI_DOLPHINS_NFL@BUFFALO_BILLS_NFL`.
2. After `--apply`, `GET /api/reference-data/matchups` returns that event with two
   entries in `teams` - not the `"teams": []` the hand-seeded canary returns.

Containment is unaffected either way: this path sets no runtime flag, and an
`operator-manual-entry` event remains ungradeable by design.

## Catalog coverage the tool can resolve against

Measured read-only against production `zfzdnfwdarxucxtaojxm` on 2026-09-18. This is what
bounds what an operator can seed today, and it is not a limitation this lane introduces.

| sport | team participants | player participants | all carry `external_id` |
|---|---|---|---|
| MLB | 30 | 951 | yes |
| NBA | 30 | 254 | yes |
| NFL | 32 | **0** | yes |
| NHL | 32 | 318 | yes |

Two consequences worth stating plainly:

- **Every** participant row in the live catalog has a non-null `external_id`, so
  `requireParticipantExternalId` will not refuse against production today. It is a guard
  against a nullable column, not against current data.
- Game-line events are seedable for all four leagues. NFL **player props are not**,
  because NFL has zero player participants. Seeding an NFL player prop would require
  minting a participant, which this tool refuses by design.

The documented invocation above was checked against the live catalog:
`BUFFALO_BILLS_NFL` -> "Bills" and `MIAMI_DOLPHINS_NFL` -> "Dolphins" both resolve.

## Known gaps

- `Live Schema Parity` is red on this PR for an infrastructure reason, not a finding:
  `Setup Supabase CLI` failed with `Failed to resolve latest Supabase CLI release: rate
  limit exceeded`, after which the drift step reported `Command "tsx" not found` with an
  empty `ACTUAL_DATABASE_URL`. This diff contains no migration for the gate to judge. It
  is not a required check.
- The tool is shipped unexercised against production, per the operator policy above.
  Its behaviour is proven against the in-memory repositories, which are the same
  interfaces (`EventRepository`, `EventParticipantRepository`, `ParticipantRepository`)
  the database implementations satisfy.

## Merge SHA Binding

Merge SHA: 17b3f964fb04faa4060fa43fc095531a4f8e8942
PR: https://github.com/griff843/Unit-Talk-v2/pull/1602
Approved PR head: pending merge
Execution SHA: 4b7957935c657b82b4394485a1858357d364a5f1
