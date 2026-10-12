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
Execution SHA: `f99394febd9fff60c80044ae1f4ec688eeaf9d3d`
Verified source SHA: `f99394febd9fff60c80044ae1f4ec688eeaf9d3d`
result: pass_pending_pm_approval

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
- [x] The feature is limited to manual-human Smart Form submission support.
- [x] Protected exact-head CI, scratch migration drills, sanctioned staging DB
      proof, and live schema parity passed.
- [ ] Independent PM review remains required before governed merge.

## EVIDENCE:

Measured local executor results:

```text
Focused required suite: 155 pass, 0 fail, 1 skipped
API server suite: 66 pass, 0 fail
pnpm type-check: PASS
pnpm verify:commands: PASS (139 migration files; 138 linted without findings)
pnpm verify:static: PASS
R-level: PASS; 18 changed files; operator-ui matched
pnpm test:db: REFUSED before mutation (host=127.0.0.1, ref=unidentified)
```

The skipped focused case is the existing scratch-Postgres catalog test gated by
the absent approved admin URL. No DB-write test began locally.

## Verification

- `pnpm exec tsx --test 'apps/api/src/smart-form-validation.test.ts' 'apps/smart-form/test/form-utils.test.ts' 'packages/db/src/canonical-reference-schema.test.ts' 'packages/db/src/pick-foreign-keys.test.ts'`:
  PASS (155 pass, 0 fail, 1 skipped).
- `pnpm exec tsx --test apps/api/src/server.test.ts`: PASS (66 pass, 0 fail).
- `pnpm type-check`: PASS.
- `pnpm test`: PASS as part of `pnpm verify:static`.
- `pnpm verify:commands`: PASS.
- `pnpm verify:static`: PASS.
- `pnpm verify`: all static stages PASS; the writable phase then correctly
  REFUSED before tests or mutation because the target was not sanctioned staging.
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`:
  PASS; `operator-ui` matched.
- `pnpm test:db`: correctly REFUSED before mutation because the local target
  resolved to `127.0.0.1/unidentified`, not the sanctioned staging project.

Writable live-DB proof is blocked/deferred: target identity could not be resolved
from its URL (host=unparseable). Writable DB verification requires
`xskgrzbteyqdufktjrjx`. Run it through the staging-ci GitHub environment with
`CI_SUPABASE_*` credentials.

Hosted exact-head receipts at `f99394febd9fff60c80044ae1f4ec688eeaf9d3d`:

- Fail-closed precondition drill: PASS — run `38321352399`, job `115049925448`.
- Schema apply/rollback/reapply round trip: PASS — run `38321352399`, job
  `115049925222`.
- Sanctioned staging writable DB proof and T1 live suites: PASS — run
  `38321352356`, job `115049925681`.
- Required `verify`: PASS — run `38321352356`, job `115055657844`.
- Live schema parity: PASS — run `38321352395`, job `115049951552`; this proves
  schema parity and does not claim a production data apply.

## Pending governed evidence

- Independent PM review and merge approval.
- Governed merge, production migration through the normal post-merge path, lane
  finalization, and orchestration reconciliation.

## Merge SHA Binding

Merge SHA: pending merge
PR: #1745
Execution SHA: f99394febd9fff60c80044ae1f4ec688eeaf9d3d
