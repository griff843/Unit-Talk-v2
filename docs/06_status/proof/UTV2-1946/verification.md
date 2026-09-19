# PROOF: UTV2-1946

Execution SHA: `d9fc89721584631a9a53a5b9f2d03aff2dff6d29`
MERGE_SHA: pending

## ASSERTIONS:

- [x] The default delivery exception population derives membership from the contracts-owned `isGovernedDeliveryTarget()` predicate, not a Command Center target list.
- [x] Rows and delivery counts are filtered by that same governed predicate before rendering.
- [x] Non-governed delivery rows require the explicitly labelled diagnostic mode and are not supplied to the operational fire board.
- [x] Dead letters older than 24 hours are shown as historical records rather than live incidents.

## EVIDENCE:

## Verification

- `pnpm exec tsx --test apps/command-center/src/lib/governed-population.test.ts` — PASS (9/9). Covers shared-predicate delegation, governed/non-governed partitioning, historical dead-letter classification, and the labelled diagnostic control.
- `pnpm type-check` — PASS.
- `pnpm test` — running at proof capture; final PR verification will record its result before submission.
- `pnpm verify:static` — pending after the aggregate suite completes.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS; `operator-ui` matched.

## Production population evidence

The captured read-only production measurement for `zfzdnfwdarxucxtaojxm` on 2026-09-19 is the population this change implements:

| status | governed | rows |
| --- | --- | ---: |
| `dead_letter` | yes | 340 |
| `processing` or `pending` | yes | 0 |
| `dead_letter` | no | 1,614 |
| `processing` | no | 32 |
| `pending` | no | 3 |

The default outbox exceptions query applies `isGovernedDeliveryTarget()` before the same filtered rows drive `failedDelivery` and `deadLetter` counts. Thus the measured governed default has no live queued/processing exception rows; its 340 old `discord:best-bets` dead letters render as historical delivery records rather than current incidents. The non-governed 32 processing rows are read-only diagnostic inventory behind the explicit labelled mode; no row is deleted or mutated.

Writable live-DB proof is blocked/deferred as directed: target identity cannot be resolved from its URL (host unparseable). Writable DB verification requires `xskgrzbteyqdufktjrjx` through the `staging-ci` GitHub environment with `CI_SUPABASE_*` credentials. This lane performs no writes.
