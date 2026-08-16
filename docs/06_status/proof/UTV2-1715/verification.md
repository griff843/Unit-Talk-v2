# PROOF: UTV2-1715

MERGE_SHA: d52972df5e530c4c569f9d28862e6a62d1dda646

Verified implementation SHA: `d52972df5e530c4c569f9d28862e6a62d1dda646`

Pre-merge this anchor identifies the verified implementation commit. Post-merge closeout automation rebinds proof artifacts to the authoritative merge SHA.

## Summary

`apps/web/**` — the public member-facing site, present on `main` — appeared in no lane type's `allowed_path_globs`. Every lane touching it failed `Lane Authority` with `outside_allowed_paths`, and no lane type could legally carry the change, so customer-facing website work was undispatchable.

This lane adds that single glob to `delivery-ui`, which already governs the other member-facing delivery surfaces. It is an admission correction, not a taxonomy change.

## ASSERTIONS:

- [x] `delivery-ui` admits `apps/web/**`.
- [x] `delivery-ui` still refuses `apps/api/**`, `packages/**`, `supabase/migrations/**`, and `.github/workflows/**` — the correction adds one delivery surface, not a general write channel.
- [x] No other lane type gains `apps/web` as a side effect: `runtime`, `modeling`, `hygiene`, `verification`, and `governance` all still refuse it.
- [x] `delivery-ui` concurrency is unchanged — `max_per_app: 1` still applies; the change adds a path, not a slot.
- [x] Both properties are mutation-proven.

## EVIDENCE:

- The gap was measured, not assumed: every lane contract under `.lane/lanes/` was checked against `apps/web/src/app/page.tsx`, and `grep -l "apps/web" .lane/lanes/*.yml` returned nothing. `delivery-ui` covered `apps/command-center`, `apps/discord-bot`, `apps/smart-form`, and `apps/qa-agent`; `runtime` covered `apps/api`, `apps/alert-agent`, `apps/ingestor`, and `apps/worker`; no contract covered `apps/web`.
- The regression asserts admission and isolation in the same test, so a future widening of `delivery-ui` into runtime or migration authority fails it.
- No lane type was added, renamed, or removed. No allowlist other than `delivery-ui`'s was touched. `forbidden_path_globs`, `singleton_types`, `type_caps`, and `forbidden_combinations` are unchanged.

## Verification

| Check | Result | Evidence |
|---|---|---|
| `pnpm verify` | PASS | Full gate green in CI on the PR head (lint, `pnpm type-check`, build, `pnpm test`). Locally the live-DB half is refused by the staging-isolation guard, which CI owns. |
| `pnpm exec tsx --test scripts/lane-contract.test.ts` | PASS | 11 tests passed, 0 failed, 0 skipped. |
| `pnpm type-check` | PASS | Completed with exit 0. |
| `pnpm test` | PASS | Root aggregate completed with exit 0. |
| `scripts/ci/r-level-check.ts` | PASS | No R-level artifacts triggered by this change. |
| Mutation battery | PASS | 2 of 2 mutations killed. |

Focused TAP summary:

```text
# tests 11
# pass 11
# fail 0
# skipped 0
```

### Mutation battery

| # | Mutation | Result |
|---|---|---|
| M1 | Remove `apps/web/**` from `delivery-ui` | killed |
| M2 | Widen `delivery-ui` with `apps/api/**` | killed |

M1 proves the admission is load-bearing. M2 proves the isolation assertion is load-bearing rather than a tautology — a widening that would grant runtime authority to a UI lane fails the same test.

### Scope and R-level disposition

One glob added to one lane contract, plus its regression. No runtime, domain, DB, migration, contract, or generated type is touched, and no production row is read or written.

### Known limitations

- This makes website work admissible. It does not perform any website work; that is the follow-on lane.
- Lane authority remains path-based. A file that moves out of `apps/web/**` later would need its own admission review.
