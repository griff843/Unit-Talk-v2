# Diff summary — UTV2-1950

MERGE_SHA: pending merge

Scope: `apps/command-center/**` (delivery-ui, T2). 114 files, +3461 / -902 against `main`.

## What changed, by area

| Area | Files | What it does |
|---|---|---|
| `apps/command-center/src/lib/` | 46 | the sanctioned read layer: governed-population predicate, query-result paging helpers, recap status, session/request auth, provider telemetry |
| `apps/command-center/src/app/` | 27 | routes, including the review and held queues repaired by this lane |
| `apps/command-center/src/components/` | 19 | operator surfaces: picks explorer, review queue, settlement form, health panels |
| `apps/command-center/e2e/` | 10 | recovery and staging Playwright specs |
| `apps/command-center/` root | 6 | package.json, next.config.mjs, three playwright configs, middleware |
| `docs/06_status/proof/UTV2-1950/` | 5 | this bundle |
| `docs/06_status/lanes/`, `.ops/sync/` | 2 | lane manifest and sync file written by `ops:lane-start` |

## The defect this lane was reopened to fix

`getReviewQueue` and `getHeldQueue` (`src/lib/data/queues.ts`) read
`picks_current_state` with `count: 'exact'` over a `.range()` window, then excluded
fixtures **in memory**. The exact count therefore described the fixture corpus while
the rendered list described what survived it, so `/review` displayed

    Source query reported 19796 matching rows before local fixture exclusion
    0 review candidates loaded

and an operator could not distinguish an empty queue from a truncated read. The
governed/fixture partition is now pushed into the query via
`applyOperatorPickPopulation()`, so the count and the list describe one population.

Measured on the production data set: `governed_total=8`, `governed_in_review=0`,
`governed_held=0` (against `all_in_review=21871`). The queue is genuinely empty —
consistent with human-capper submissions never entering `awaiting_approval` — and the
page now says so instead of contradicting itself. `/review` 9.9s -> 0.56s,
`/held` 10.0s -> 0.48s.

`src/lib/data/queues-governed-population.test.ts` asserts the partition reaches
PostgREST (`metadata->distributionMode=not.is.null`, five fixture-marker exclusions,
and the `selection` proof filter). It was mutation-tested: removing either push-down
fails it, restoring both passes. It deliberately does not accept the in-memory filter
as satisfying the assertion.

## Scope carve-out

13 runtime/deploy files that were on this branch at `716b698fb` were reverted in
`b09afe0b1` and are preserved verbatim for a sibling `runtime` lane: `apps/api/**` (7),
`deploy/rollback.sh`, `.github/workflows/staging-db-proof.yml`, `.env.example`,
`package.json`, `scripts/ci/staging-path-enforcement.test.ts`,
`scripts/ops/command-center/staging-operator-proof.ts`.

No lane type in `.lane/lanes/` admits both `apps/command-center/**` and `apps/api/**`:
`deriveDeliveryUiApp()` fails closed unless every `file_scope_lock` entry sits under one
canonical app root, and `runtime` does not admit the Command Center. Nothing was dropped.
