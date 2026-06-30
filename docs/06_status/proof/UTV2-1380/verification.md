# UTV2-1380 Verification

## Verification

- `npx tsx --test apps/api/src/submission-service.test.ts` — PASS, 73/73.
- `npx tsx --test apps/api/src/promotion-edge-integration.test.ts` — PASS, 74/74.
- `rg "@unit-talk/db|@unit-talk/config|apps/" packages/domain/src` — PASS; matches are historical comment references only.
- `pnpm type-check` — PASS.
- `pnpm test` — PASS.
- `pnpm verify` — PASS, including `test:db` 7/7 and live T1 proof suite.

## Issue-Specific Coverage

- Submission path now writes `metadata.kellySizing` from market-backed real-edge inputs before promotion when direct devigging lookup is unavailable.
- Promotion path now enriches missing `metadata.kellySizing` before score input reads, risk scoring, and band assignment.
- Kelly sizing remains `null` when required inputs are unavailable, including missing odds or missing market-backed real-edge probability.
- Confidence-delta remains excluded from Kelly sizing and promotion edge contribution.

## R-Level

- Triggered rules from changed paths: `lifecycle-fsm`, `promotion-scoring`.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS.
- Advisory only: `r4-fault-report` missing; PM-gated advisory artifact, not required for this T2 diff.
