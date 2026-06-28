# UTV2-1349 Verification Log

## Verification

Issue: UTV2-1349, T2 proof lane for M4 capper attribution evidence.

## Commands

| Command | Result | Notes |
| --- | --- | --- |
| `pnpm type-check` | PASS | TypeScript project references check exited 0. |
| `npx tsx --test apps/api/src/submission-service.test.ts` | PASS | 73 tests passed, 0 failed. Covers submission behavior around capper identity consumers and smart-form submission metadata. |
| `rg -n "capper: payload\\.submittedBy\|metadata\\.capper\|submittedBy" apps/api/src/submission-service.ts apps/api/src/submission-service.test.ts` | PASS | Confirmed primary and shadow submission paths set `capper: payload.submittedBy`. |
| `rg -n "submittedBy\|capper" apps/smart-form/lib/form-utils.ts apps/smart-form/test/form-utils.test.ts` | PASS | Confirmed smart-form payload builder sends `submittedBy: values.capper`. |
| `npx tsx apps/api/src/scripts/utv2-1346-capper-attribution-proof.ts` | FAIL | Read-only script hit Supabase statement timeout on broad ordered query. No mutation occurred. |
| Narrow read-only Supabase REST query for `source=smart-form` and `metadata->>submittedBy=not.is.null` | PASS | Returned historical smart-form rows with `metadata.submittedBy`. |
| Narrow read-only Supabase REST query for `source=smart-form` and `metadata->>capper=not.is.null` | PASS | Returned `[]` for sampled live rows. |
| `pnpm test` | FAIL, then isolated failing test PASS | Root test had one failure in `scripts/codex-receive.test.ts`; rerunning that file passed all 6 tests. |
| `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS | `Changed files: 2`; no R-level rules matched. |

## Evidence

Capper attribution code path:

```text
apps/api/src/submission-service.ts:332: ...(payload.submittedBy ? { capper: payload.submittedBy } : {}),
apps/api/src/submission-service.ts:541: ...(payload.submittedBy ? { capper: payload.submittedBy } : {}),
```

Smart-form source identity:

```text
apps/smart-form/lib/form-utils.ts:306: submittedBy: values.capper,
apps/smart-form/lib/form-utils.ts:319: capper: values.capper,
```

Focused test outcome:

```text
1..73
# tests 73
# pass 73
# fail 0
```

R-level outcome:

```text
Verdict: PASS
Changed files: 2
Rules matched: (none) - no R-level artifacts required for this diff
```

### pnpm verify

Run: `pnpm verify` (2026-06-28)

All static and unit test suites passed:

| Check | Result |
| --- | --- |
| `pnpm lint` | PASS |
| `pnpm type-check` | PASS |
| `pnpm build` | PASS |
| `pnpm test` (all unit suites) | PASS — 700+ tests, 0 failures |
| `pnpm test:db` (live Supabase) | PARTIAL — 6/7 passed; 1 failed with `canceling statement due to statement timeout` on `settlement.listRecent` (Supabase infra flake, unrelated to this diff) |

The `test:db` failure is a known Supabase statement timeout on settlement queries, consistent with the active DB constraint described in existing ops memory. It is not caused by this change and does not affect T2 gate. All T2-required checks (type-check + test) are green.

### M4 Verdict

PARTIAL — Code path confirmed correct (73/73 unit tests, source grep). Live data shows no new smart-form picks with `metadata.capper` yet (expected: no new submissions post-deploy in the observation window). The attribution gap is closed in code. Live corpus readiness requires new smart-form picks to flow through after deployment.
