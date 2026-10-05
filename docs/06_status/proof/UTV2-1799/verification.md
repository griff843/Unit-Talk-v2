# PROOF: UTV2-1799

MERGE_SHA: 4070a3994614978112fc5fc02584bd23e12b27bf

PR: https://github.com/griff843/Unit-Talk-v2/pull/1716
Tier: T2
Merge SHA: 4070a3994614978112fc5fc02584bd23e12b27bf

## Verification

- pnpm type-check: PASS after keeping root-script execution outside the API project boundary.
- pnpm verify:static: PASS (lint, type-check, build, full pnpm test, production-post-migration checks, Smart Form static verification, and command verification).
- pnpm verify: static portion PASS; live portion REFUSED localhost (unidentified target), before DB proof execution.
- pnpm exec tsx --test scripts/ops/provider-offer-column-guard.test.ts: 25 PASS after review corrections.
- pnpm exec tsx --test scripts/ingestor-alert-check.test.ts: 23 PASS; guard now runs directly through test:ops.
- pnpm ops:automation-coverage-check: PASS; new guard is required-reachable, with no new unwired test.
- pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD: PASS; no matching R-level rules.
- git diff --check: PASS.

## ASSERTIONS:

- [x] Both readers issue SELECT updated_at FROM provider_offer_current ORDER BY updated_at DESC LIMIT 1.
- [x] Fresh fixtures preserve the timestamp and healthy/OK result.
- [x] Stale fixtures retain non-healthy and CRITICAL behavior at the existing thresholds.
- [x] Empty rows, missing timestamps, and missing credentials cannot report healthy.
- [x] Returned query errors throw explicit observer failures; they remain distinct from stale/empty truth.
- [x] Existing monitor alerting/canary/member-containment tests remain green.
- [x] Stop and restart's stop phase use only local supervisor state and process checks, never DB observation. Mocked query and transport failures do not prevent SIGTERM.
- [x] Executable .ts, .js, .mjs, and .cjs files participate in the guard; each extension has a filesystem-discovery inversion regression.
- [x] Staging smoke execution resolves reader modules absolutely from import.meta.url and fixes child cwd to the repository root. Both smoke cases exercise a non-root caller and restore its cwd.

## EVIDENCE:

### Guard Inversion

Each original query was separately changed back to provider_offers, then the executable repo-wide guard was run:

```text
pnpm exec tsx --test --test-name-pattern=all scripts/ops/provider-offer-column-guard.test.ts
health-check inversion: exit 1; hit scripts/ops/ingestor-health-check.ts:117
supervisor inversion: exit 1; hit scripts/ingestor-supervisor.ts:383
restored repair: 17 tests passed, 0 failed
```

## Live Proof

Local writable DB proof was not bypassed or run against production. Authorized staging-ci run https://github.com/griff843/Unit-Talk-v2/actions/runs/37302741388 passed for source HEAD 20d9f18d54ba19a72cf97fac6c5dbc1045e89096. Both SELECT-only smoke cases executed (not skipped), each returning 2026-10-05T11:25:51.937+00:00 while exercising a non-root caller. Existing live suites passed. Required verify passed static verification and same-run receipt validation: staging xskgrzbteyqdufktjrjx, 9 passed / 0 failed / 0 skipped, merge ref 40f70a3db83744d897ac361aac127340fcfd75b9. Final metadata HEAD requires its own CI rerun; do not reuse this result as its exact-head receipt.

No production health claim is made from mocked tests or an empty staging table.

## Merge SHA Binding

Merge SHA: 4070a3994614978112fc5fc02584bd23e12b27bf
PR: https://github.com/griff843/Unit-Talk-v2/pull/1716
Execution SHA: bd57a2e2ca8ca9a4cad470d771720be5f0deec3d
