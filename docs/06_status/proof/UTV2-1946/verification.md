# PROOF: UTV2-1946

## Verification

- `pnpm exec tsx --test apps/command-center/src/lib/governed-population.test.ts` — PASS (9/9). Covers shared-predicate delegation, governed/non-governed partitioning, historical dead-letter classification, and the labelled diagnostic control.
- `pnpm type-check` — PASS.
- `pnpm test` — running at proof capture; final PR verification will record its result before submission.
- `pnpm verify:static` — pending after the aggregate suite completes.

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
