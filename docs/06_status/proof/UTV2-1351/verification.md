# UTV2-1351 Verification Log

Issue: UTV2-1351
Tier: T2
Branch: codex/utv2-1351-m4-capper-attribution-live-observation
Generated: 2026-06-28T23:52:29Z

## Verification

| Command | Result | Evidence |
| --- | --- | --- |
| `pnpm type-check` | PASS | TypeScript project-reference check completed with exit code 0. |
| `pnpm test` | PASS | Root aggregate test suite completed with exit code 0. |
| `rg -n "capper: payload\\.submittedBy|metadata\\.capper|submittedBy" apps/api/src/submission-service.ts apps/api/src/submission-service.test.ts apps/smart-form/lib/form-utils.ts apps/smart-form/test/form-utils.test.ts` | PASS | Confirmed smart-form payload sends `submittedBy`, API maps `submittedBy` into `metadata.capper`, and tests assert the expected metadata. |
| `npx tsx apps/api/src/scripts/utv2-1346-capper-attribution-proof.ts` | PASS | Read-only live observation found 20 recent smart-form picks. Current sample: 0 with `metadata.capper`, 0 with `metadata.submittedBy`, and 20 with neither field. |
| `pnpm verify` | PASS | Gate completed with exit code 0, including static verification, `pnpm test:db`, and live T1 proof suites. |

## Issue-Specific Evidence

Source path evidence:

- apps/smart-form/lib/form-utils.ts:306 serializes smart-form capper input as `submittedBy: values.capper`.
- apps/api/src/submission-service.ts:332 maps submission `payload.submittedBy` to `metadata.capper` when creating the canonical pick metadata.
- apps/api/src/submission-service.ts:541 applies the same `payload.submittedBy` to `metadata.capper` in the persisted payload path.
- apps/api/src/submission-service.test.ts:2599 asserts stored metadata contains the submitted capper value.

Live observation:

```text
Found 20 recent smart-form picks.
Picks with metadata.capper set:      0
Picks with submittedBy but no capper: 0 (pre-fix)
Picks with neither:                   20
```

Verdict: no eligible live smart-form sample with `submittedBy` was present at observation time, so this lane cannot claim a persisted live row proves `metadata.capper` yet. The live corpus also shows no pre-fix `submittedBy`-without-`capper` rows in the recent sample. The implementation path is present and covered by existing tests; the next smart-form submission that carries a capper value should persist it into `metadata.capper`.

## Gate Evidence

`pnpm verify` completed successfully. The gate included:

- `verify:static`: PASS
- `pnpm lint`: PASS
- `pnpm type-check`: PASS
- `pnpm build`: PASS
- `pnpm test`: PASS
- `pnpm test:db`: PASS, 7 tests passed
- `pnpm test:t1-proof:live`: PASS across the live T1 proof suites

Non-fatal live proof warnings were observed for devig enrichment statement timeouts during proof setup; the affected tests handled the skipped enrichment path and passed.

## R-Level Compliance

Final committed-diff check:

```text
npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 4
Rules matched: (none) - no R-level artifacts required for this diff
```
