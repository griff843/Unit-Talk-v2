# Verification Log - UTV2-1032

Generated: 2026-05-28T00:45:42.815Z
Branch: codex/utv2-1032-developing-label-proof-run-trigger-after-50-real-edge-backed

## Focused Checks

- `pnpm exec tsx --test scripts/roi-by-sport.test.ts` - PASS
- `pnpm type-check` - PASS
- `pnpm test` - PASS, 619 tests passed
- `pnpm exec tsx scripts/roi-by-sport.ts --real-edge-only --after=2026-05-10 --monitor-json` - PASS, result DATA_GATED with 0 real-edge-backed settled rows
- `pnpm exec tsx scripts/roi-by-sport.ts --real-edge-only --after=1970-01-01 --monitor-json` - PASS, result DATA_GATED with 5 real-edge-backed settled rows
- `pnpm verify` - PASS
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` - PASS, no R-level artifacts required

## Acceptance Criteria Status

- `roi-by-sport.ts --real-edge-only` reports >=50 settled picks: FAIL, current post-fix value is 0 and all-time value is 5.
- ROI point estimate positive: FAIL, no measurable stake-backed real-edge sample is available.
- CLV coverage >=60%: FAIL, post-fix value is n/a and all-time value is 0%.
- Evidence bundle generated: PASS, see `docs/06_status/proof/UTV2-1032/evidence.json`.
- `MODEL_EDGE_ACCEPTANCE_STANDARD.md` tier label updated to DEVELOPING: NOT DONE because live proof does not satisfy the threshold.

## Closeout Decision

Do not assert DEVELOPING from this proof run. The implementation can now isolate real-edge-backed rows, but current production evidence remains below the acceptance threshold.
