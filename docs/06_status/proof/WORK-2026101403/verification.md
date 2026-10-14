# PROOF: WORK-2026101403

MERGE_SHA: pending merge

Issue: WORK-2026101403
Tier: T2
result: local_static_pass_staging_deferred
verified source SHA: `bcfbf571fa7002b1d581b12b3e01ef9afd3a178d`

## ASSERTIONS

- [x] `CURLING` is not a supported promotion scoring sport, so its recorded score is capped at 60.
- [x] `deriveSportId({ sport: 'CURLING', betType: 'moneyline' })` resolves no canonical sport ID, so the pick can be written without a WNBA catalog row.
- [x] The submission metadata path accepts the arbitrary `CURLING` string under the same contract previously used by `WNBA`.
- [x] Mutation reasoning is measured: the fixture scores 60 with `CURLING`, while replacing it with supported sport `NBA` scores 85 and would fail the retained `<= 60` assertion.
- [x] Existing WNBA references in the three named test files remain unchanged.

## EVIDENCE

Focused test with the live-DB guard active, executed from a neutral working directory so repository credentials were not loaded:

```text
pnpm exec tsx --test /absolute/path/apps/api/src/t1-proof-utv2-1954-promotion-replay.test.ts
tests 5; pass 0; fail 0; skipped 5; exit 0
```

Mutation check:

```text
{"curling":60,"nba":85}
```

Writable live-DB proof is blocked/deferred to the protected `staging-ci` GitHub environment. The local repository-root attempt could not reach its configured endpoint (`TypeError: fetch failed`), and `pnpm verify` safely refused DB execution because it observed `host=127.0.0.1 ref=unidentified` instead of required project ref `xskgrzbteyqdufktjrjx`. No DB write was attempted or claimed.

## Verification

| Command | Result |
|---|---|
| `pnpm exec tsx --test apps/api/src/t1-proof-utv2-1954-promotion-replay.test.ts` | Live cases attempted with locally loaded credentials and failed on initial network fetch; not claimed as a passing live run. |
| Guarded focused test from neutral working directory | PASS: exit 0; 5 live-DB cases skipped by guard. |
| Direct promotion-score mutation check (`CURLING` versus `NBA`) | PASS: 60 versus 85. |
| `pnpm type-check` | PASS: exit 0. |
| `pnpm lint` | PASS: exit 0. |
| `pnpm verify:static` | PASS: exit 0. |
| `pnpm verify` | Static stages passed; live DB stage deferred by the staging identity guard. |
| `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS on implementation SHA; rerun after proof commit is required. |

## Pending governed closeout

- Protected staging CI must run the writable live-DB proof with `CI_SUPABASE_*` credentials for project `xskgrzbteyqdufktjrjx`.
- PM approval, governed merge, lane finalization, and canonical post-merge reconciliation remain pending.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1757
