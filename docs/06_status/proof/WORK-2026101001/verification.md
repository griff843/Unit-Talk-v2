# PROOF: WORK-2026101001

MERGE_SHA: pending merge

Issue: WORK-2026101001
Tier: T2
result: documentation-only contract amendment; no runtime proof applicable

## ASSERTIONS:

- [x] Contract §2 rules 2 and 5 contradict the shipped runtime: `DatabaseReferenceDataRepository.searchTeams()` (`packages/db/src/runtime-repositories.ts`) reads `participants` and returns `participants.id` (#1535, #1536).
- [x] The diff is one additive Amendment A in `T1_CANONICAL_MIGRATION_AND_COMPATIBILITY_CONTRACT.md` (+20 lines, 0 deletions) superseding rules 2 and 5 for the Smart Form / team-selection phase only.
- [x] `participants` is canonical for the phase; `teams`, `players`, `player_team_assignments` and `provider_entity_aliases` are untouched; a future `teams` cutover stays separate and unauthorized.
- [x] No code, schema, runtime, containment or #1730 change.

## EVIDENCE:

```
$ pnpm ops:preflight WORK-2026101001 --tier T2 --branch claude/work-2026101001-participants-canonical-ratification
VERDICT: PASS (39 checks)

$ git diff --stat origin/main -- docs/05_operations
 docs/05_operations/T1_CANONICAL_MIGRATION_AND_COMPATIBILITY_CONTRACT.md | 20 ++++++++++++++++++++
```

Required CI `verify` passed on the lane head; R-Level Compliance and Proof Auditor gates passed.

## Verification

- Contradiction measured against `searchTeams()` and the contract text, as above.
- `pnpm verify` PASS in the required CI `verify` context. No DB access or writes are part of this documentation-only lane.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1733
