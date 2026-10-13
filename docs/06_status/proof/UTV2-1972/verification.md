# PROOF: UTV2-1972 — Verification

MERGE_SHA: pending merge

> This is pre-merge executor evidence. It does not claim PM approval, merge,
> production migration, deployment, event seeding, provider activation, delivery
> release, lane finalization, or canonical post-merge closeout.

Issue: UTV2-1972
Tier: T1
Lane type: migration
Proof profile: migration
PR: https://github.com/griff843/Unit-Talk-v2/pull/1745
Execution SHA: `fdafdfbabf0dcdba4ced01cb72635d9d3d3a7e20`
Verified source SHA: `fdafdfbabf0dcdba4ced01cb72635d9d3d3a7e20`
result: execution_pass_pending_governance

## ASSERTIONS:

- [x] The migration freezes exactly 15 active 2026 WNBA franchises from the
      official WNBA team directory, including Golden State, Portland, and Toronto.
- [x] Cleveland is excluded because its announced inaugural season is 2028.
- [x] Franchise UUIDs are deterministic UUIDv5 values; reruns neither duplicate
      rows nor churn existing canonical identities.
- [x] The migration preserves matching existing identities, refuses canonical
      identity ambiguity, and adds no invented provider IDs.
- [x] Franchise identities are written to `participants`; `teams` is untouched.
- [x] WNBA exposes the existing basketball market registry; the runtime Smart
      Form validation/FK changes were separated from this migration lane.
- [x] Rollback discovers every FK targeting the seed-owned sport and league,
      locks the parent rows, and refuses before mutation when downstream state exists.
- [x] Expected availability edges are removed only when the sport is seed-owned;
      compatible pre-existing WNBA rows remain unchanged.
- [x] The feature is limited to manual-human Smart Form submission support.
- [x] Local PostgreSQL 16 rollback, concurrency, and reversibility drills passed.
- [ ] Protected exact-head CI remains pending for the repaired head.
- [ ] Independent PM review remains required before governed merge.

## EVIDENCE:

Measured local executor results:

```text
packages/db suite on scratch PostgreSQL 16: 298 pass, 0 fail, 0 skipped
focused canonical-reference suite: 30 pass, 0 fail, 0 skipped
migration reversibility adversarial suite: 10 pass, 0 fail
participant seed lifecycle suite: 14 pass, 0 fail
@unit-talk/db type-check: PASS
pnpm verify:commands: PASS (139 migration files; 138 linted without findings)
pnpm verify:static: PASS
R-level: PASS; 9 changed files; no R-level rules matched
pnpm test:db: REFUSED before mutation (host=127.0.0.1, ref=unidentified)
```

No production or staging database was accessed. All applied migrations and data
mutations occurred only in disposable local PostgreSQL 16 scratch databases.

## Verification

- `PARTICIPANT_CATALOG_TEST_ADMIN_URL=<local-postgres-16> pnpm exec tsx --test packages/db/src/*.test.ts`:
  PASS (298 pass, 0 fail, 0 skipped).
- Focused `canonical-reference-schema.test.ts`: PASS (30/30), including clean
  and pre-existing baselines, participant refusal, all named downstream FKs,
  generic future FKs, atomic snapshots, and concurrent `picks` inserts.
- Migration reversibility gate: PASS; down-script check and 10/10 adversarial tests.
- Participant seed lifecycle drill: PASS (14/14) on local PostgreSQL 16.
- `pnpm --filter @unit-talk/db type-check`: PASS.
- `pnpm test`: PASS as part of `pnpm verify:static`.
- `pnpm verify:commands`: PASS.
- `pnpm verify:static`: PASS.
- `pnpm verify`: all static stages PASS; the writable phase then correctly
  REFUSED before tests or mutation because the target was not sanctioned staging.
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`:
  PASS; no R-level rules matched.
- `pnpm test:db`: correctly REFUSED before mutation because the local target
  resolved to `127.0.0.1/unidentified`, not the sanctioned staging project.

Writable live-DB proof is blocked/deferred: target identity could not be resolved
from its URL (host=unparseable). Writable DB verification requires
`xskgrzbteyqdufktjrjx`. Run it through the staging-ci GitHub environment with
`CI_SUPABASE_*` credentials.

Earlier hosted receipts are not reused for the repaired source. Protected CI
must bind fresh receipts to the pushed exact PR head.

## Pending governed evidence

- Independent PM review and merge approval.
- Protected exact-head CI for the repaired head.
- Proof Coverage Guard disposition without adding a proof source file outside
  the packet's allowed scope; the sanctioned staging proof itself passed.
- Governed merge, production migration through the normal post-merge path, lane
  finalization, and orchestration reconciliation.

## Merge SHA Binding

Merge SHA: pending merge
PR: #1745
Execution SHA: fdafdfbabf0dcdba4ced01cb72635d9d3d3a7e20
