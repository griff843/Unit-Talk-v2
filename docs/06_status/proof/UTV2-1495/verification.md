# UTV2-1495 Verification

## Verification

- `pnpm type-check` - PASS
- `npx tsx --test scripts/ci/file-scope-guard.test.ts` - PASS
- `npx tsx --test scripts/ops/workflow-hardening.test.ts` - PASS
- `pnpm exec tsx scripts/ci/file-scope-guard.ts --branch codex/utv2-1495-hard-file-scope-lock-enforcement --base HEAD --head HEAD --output-json .out/file-scope-local.json` - PASS
- `pnpm test` - PASS
- `pnpm verify` - PASS
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` - PASS (`Rules matched: (none)`)

## Notes

- The new issue-specific test file is not currently wired into the root `test:ops` explicit file list, so it was run directly with `tsx --test`.
- The guard intentionally permits `expected_proof_paths` and the lane's own control-plane scaffold in addition to `file_scope_lock` so required lane proof and manifest files do not violate hard implementation file-scope enforcement.
- Live DB verification passed as part of `pnpm verify`; one bounded-dedup live proof skipped its window-content assertion because provider data is older than the 72h lookback window, while the command exited successfully.
