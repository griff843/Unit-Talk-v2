# UTV2-1799 Verification

MERGE_SHA: pending merge

PR: https://github.com/griff843/Unit-Talk-v2/pull/1716
Tier: T2
Merge SHA: pending merge

## Verification

- pnpm type-check: PASS after keeping root-script execution outside the API project boundary.
- pnpm verify:static: PASS (lint, type-check, build, full pnpm test, production-post-migration checks, Smart Form static verification, and command verification).
- pnpm verify: static portion PASS; live portion REFUSED localhost (unidentified target), before DB proof execution.
- pnpm exec tsx --test scripts/ops/provider-offer-column-guard.test.ts: 17 PASS.
- pnpm exec tsx --test scripts/ingestor-alert-check.test.ts with required guard import: 40 PASS.
- pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD: PASS; no matching R-level rules.
- git diff --check: PASS.

## Assertions

- Both readers issue SELECT updated_at FROM provider_offer_current ORDER BY updated_at DESC LIMIT 1.
- Fresh fixtures preserve the timestamp and healthy/OK result.
- Stale fixtures retain non-healthy and CRITICAL behavior at the existing thresholds.
- Empty rows, missing timestamps, and missing credentials cannot report healthy.
- Returned query errors throw explicit observer failures; they remain distinct from stale/empty truth.
- Existing monitor alerting/canary/member-containment tests remain green.

## Guard Inversion

Each original query was separately changed back to provider_offers, then the executable repo-wide guard was run:

```text
pnpm exec tsx --test --test-name-pattern=all scripts/ops/provider-offer-column-guard.test.ts
health-check inversion: exit 1; hit scripts/ops/ingestor-health-check.ts:117
supervisor inversion: exit 1; hit scripts/ingestor-supervisor.ts:383
restored repair: 17 tests passed, 0 failed
```

## Live Proof

Local writable DB proof was not bypassed or run against production. Authorized staging-ci must execute both new SELECT-only smoke cases and the existing proof suites on the final PR HEAD. Exact-head results and receipt will be linked from the PR after CI completes.

No production health claim is made from mocked tests or an empty staging table.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1716
Execution SHA: bd57a2e2ca8ca9a4cad470d771720be5f0deec3d
