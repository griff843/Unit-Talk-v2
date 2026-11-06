# WORK-2026110601 — bounded population guard statement retry

Tier: T1. Source code SHA: `f246e1b0ec32fb0cf300de41b188172b24f1d411`.

| File | Change |
|---|---|
| `packages/db/src/runtime-repositories.ts` | Fresh-query guard wrapper retries W, check 2, check 3 and end count at most three times each. Exhaustion throws a nonempty message with available code/HTTP status. Count retries retain W and the last cursor. |
| `packages/db/src/member-performance-read-completeness.test.ts` | Fourteen regressions cover transient returned/thrown 57014 on each statement, exact exhaustion bounds, diagnostic fields, no returned rows, unchanged page count and drift during retry. |
| `docs/06_status/proof/WORK-2026110601/*` | Source-bound verification, mutation logs, model-routing declaration and verification boundaries. |

All 125 prior regressions remain. No new `any` cast. Data queries, count validation, drift retries, keyset predicates, redundant `created_at` bound, exact cursor text, ordering, 100,000-row budget and page cap are unchanged. Only the guard's read-only statements are retried; each factory creates a fresh request. Other statement failures also receive the same finite retry budget and remain fail-closed.

For a fixed cursor L, check 2 selects `updated_at > W AND created_at <= L.created_at`, without a status filter. Keeping the same W throughout a statement retry cannot shrink this predicate's detection window. A newly captured later W could hide a change during the failed statement, so it is deliberately not captured. If a successful retry detects drift, the existing whole-read retry discards that attempt and captures a fresh W before fresh data pages.

## Verification boundary

| Boundary | Evidence / limitation |
|---|---|
| Guard behavior | Deterministic PostgREST-cap double, baseline regression and three mutation controls; no live failure injection. |
| Live persistence | Local writable tests are blocked/deferred by staging identity checks. Only `staging-ci` with `CI_SUPABASE_*` may run writable proof against `xskgrzbteyqdufktjrjx`. |
| Exact PR head | GitHub CI must run the existing keyset live suite and full T1 live suites at the final PR head. A local unit pass is not staging evidence. |
| Slowdown | The slowdown's cause is **not identified**. This change adds resilience, not a diagnosis or a measured speedup. |
| Index / DDL | No index on `picks(updated_at)` is added. No DDL. Production index decisions remain Griff's. |
| Production | No production mutation, deploy, delivery, kill-switch change or target activation. |
| Governance | Draft review candidate only. PM approval, merge, outer-wrapper attestation, lane finalization and post-merge reconcile remain pending. |

Merge SHA: pending merge
