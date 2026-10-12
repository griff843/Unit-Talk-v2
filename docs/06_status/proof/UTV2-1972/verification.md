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
Execution SHA: `f9a6b538c6b2f76cde1f474ebfbb1075ab012a87`
result: review_candidate_pending_protected_ci

## ASSERTIONS:

- [x] The migration freezes exactly 15 active 2026 WNBA franchises from the
      official WNBA team directory, including Golden State, Portland, and Toronto.
- [x] Cleveland is excluded because its announced inaugural season is 2028.
- [x] Franchise UUIDs are deterministic UUIDv5 values; reruns neither duplicate
      rows nor churn existing canonical identities.
- [x] The migration preserves matching existing identities, refuses canonical
      identity ambiguity, and adds no invented provider IDs.
- [x] Franchise identities are written to `participants`; `teams` is untouched.
- [x] WNBA exposes existing basketball markets/stats, and API/UI team-sport
      validation agrees with DB basketball sport-FK normalization.
- [x] The feature is limited to manual-human Smart Form submission support.
- [ ] Protected exact-head CI, sanctioned staging DB proof, and independent PM
      review remain required before governed merge.

## EVIDENCE:

Measured local executor results:

```text
Focused required suite: 161 pass, 0 fail, 1 skipped
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
  PASS (161 pass, 0 fail, 1 skipped).
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

## Pending governed evidence

- Protected exact-head CI and its sanctioned staging-DB receipt.
- Independent PM review and merge approval.
- Governed merge, production migration through the normal post-merge path, lane
  finalization, and orchestration reconciliation.

## Merge SHA Binding

Merge SHA: pending merge
PR: #1745
Execution SHA: f9a6b538c6b2f76cde1f474ebfbb1075ab012a87
