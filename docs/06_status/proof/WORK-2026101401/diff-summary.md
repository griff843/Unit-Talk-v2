# Diff summary: WORK-2026101401

## Summary

Restore existing authenticated /api/operator/stats and /api/operator/leaderboard reads through canonical apps/api. Public responses include only aggregate settled official performance with verified human capper and authentic sent Discord-message provenance. Track Only, fixtures, simulations, internal/private sources and active picks are excluded. Uncertain or incomplete required data returns unavailable rather than partial success.

Pure domain helpers resolve confirmed correction chains and calculate recorded-stake/odds units and ROI. Unsupported metrics stay null. Stable bounded repository pagination and two complete service observations detect truncation, duplicate/ordering failures and observed population/history/provenance changes. They do not create atomic database isolation.

| File | Change |
|---|---|
| apps/api/src/server.ts | Mount existing performance endpoints through canonical API. |
| apps/api/src/routes/member-performance.ts | Authenticate operator/configured bot identity and project aggregate-only responses. |
| apps/api/src/member-performance-service.ts | Complete public eligibility, provenance, consistency and bounded aggregation. |
| apps/api/src/member-performance-service.test.ts | Completeness, authentic receipts, privacy, exclusions and service calculations. |
| apps/api/src/member-performance-routes.test.ts | Existing response contracts and authentication/refusal boundaries. |
| packages/domain/src/member-performance.ts | Pure settlement correction, attribution, units, ROI and ranking logic. |
| packages/domain/src/member-performance.test.ts | Calculation, correction and ranking cases. |
| packages/domain/src/index.ts | Minimal helper re-export. |
| packages/db/src/runtime-repositories.ts | Three complete stable readers and matching memory ordering only. |
| packages/db/src/member-performance-read-completeness.test.ts | Actual reader methods with query doubles, caps/counts/order/416/errors. |
| apps/api/src/t1-proof-utv2-1907-capper-attribution.test.ts | Separately approved staging guard and read-only real PostgREST count/filter/order/slice proof for the three repaired readers; existing fixtures/cases retained. |
| package.json | Separately human-approved one-line append of four direct test commands to test:apps. |
| .ops/sync/WORK-2026101401.yml; docs/06_status/lanes/WORK-2026101401.json; this proof directory | Normal admitted lane and measured proof bookkeeping. |

## Evidence

Original issue #1749 plan and two-file completeness extension are recorded in comments 6152054506 and 6152176343. The subsequent package.json wiring addition was explicitly approved in the Discord program chat. Immutable scope lock is retained; external current-PR/HEAD scope override is still required. Source implementation 9c28a7308d28cfbe48a1c3ad48508ec6cd6c9d21; wiring ccd89881c064aa68de1e0eac8faab9d5686b60b3.

## Verification

See verification.md for measured commands, exact source binding and pending gates. 155 new focused tests and 27 existing member-picks regressions passed. Full static verification passed with 7828 node:test passes, 13 skips and zero failures across reported suite totals. Full pnpm verify exits 1 at localhost staging identity refusal; live DB proof remains deferred to sanctioned exact-head CI. No production deployment, delivery activation, migrations, writes, worker changes or bot command changes. Independent PM merge authority remains pending.

## SHA Binding

Merge SHA: pending merge
PR: pending

## Latest source extension

eac896c5f0d75d8f45369df26505376e5335d1e3 adds only the existing live-proof test. Its scope was explicitly approved by Griff in the continuation chat. Static verification again reports7828 passes/13 skips/0 failures; full local verify and direct live-proof file run refuse the non-staging target before live DB work. Fresh final-head CI, exact scope exception and independent PM verdict remain required. Prior receipts are historical; no positive live large-page, public receipt or deployed Discord proof is claimed.


Timestamp correction (source512bc3552): variable-precision SQL timestamps now compare as precise instants only in the three approved complete readers and their InMemory counterparts. Added three hand-ordered regression cases in the already-approved completeness test; adjusted the approved live-proof assertion. Direct103/103 pass; old code fails all three new cases. Fresh full verification/staging pending; failed CI38817617158 retained.
