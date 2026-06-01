# UTV2-1148 Verification

## Verification

- `npx tsx --test packages/domain/src/adversarial/manipulation-detector.test.ts packages/domain/src/adversarial/provider-anomaly.test.ts` — PASS, 8/8 tests.
- `pnpm type-check` — PASS.
- `pnpm test` — PASS.
- `pnpm test:db` — PASS, 7/7 live DB smoke tests.
- `pnpm verify` — PASS.
- `pnpm ops:runtime-health -- --json` — executed as runtime proof; returned FAILED because live runtime has 189 `dead_letter` outbox rows and stale provider freshness. This lane is pure domain code and did not mutate runtime state.

Runtime proof details are captured in `docs/06_status/proof/UTV2-1148/evidence.json`.
