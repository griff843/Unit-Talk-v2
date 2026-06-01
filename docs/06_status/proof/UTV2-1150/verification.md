# UTV2-1150 Verification

## Verification

Implemented the adversarial burn-in harness in `packages/domain/src/adversarial/burn-in.ts` with typed scenario/run/result contracts, deterministic run IDs, replay stability checks, escalation/non-escalation count validation, clock reset fail-closed handling, and domain package exports.

Commands run:

| Command | Result | Notes |
|---|---:|---|
| `npx tsx --test packages/domain/src/adversarial/burn-in.test.ts` | PASS | 4 focused burn-in tests passed. |
| `pnpm type-check` | PASS | TypeScript project references completed with exit code 0. |
| `pnpm test` | PASS | Root aggregate completed with exit code 0, including live T1 proof tests. |
| `pnpm test:db` | PASS | 7 DB smoke tests passed. |
| `pnpm ops:runtime-health -- --json` | FAIL | Existing runtime state: 192 dead-letter rows and stale provider freshness. No UTV2-1150 files write runtime queues or provider data. |
| `pnpm verify` | PASS | Full gate completed with exit code 0. |
| `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS | `Verdict: PASS`; no R-level rules matched. |

R-level lookup:

`docs/05_operations/r1-r5-rules.json` did not match the changed paths:

- `packages/domain/src/adversarial/burn-in.ts`
- `packages/domain/src/adversarial/burn-in.types.ts`
- `packages/domain/src/adversarial/burn-in.test.ts`
- `packages/domain/src/index.ts`

R-level compliance: N/A — `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` returned `Verdict: PASS` and no rules matched.

Runtime proof note:

`pnpm ops:runtime-health -- --json` returned `FAILED` with `runtime:health` and `pipeline:health` failed. The reported causes were 192 dead-letter rows, stale provider freshness, and pipeline dead-letter review requirements. This is recorded as current runtime truth and is outside this domain-only burn-in harness lane.
