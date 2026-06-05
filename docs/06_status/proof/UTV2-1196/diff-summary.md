<!-- merge_sha: b2aaa72ba1b1e66535806abf9646d32128ce9e69 -->
## Summary

UTV2-1196 makes the T1 proof gates execution-bound for live DB smoke coverage. The previous C2 check accepted a proof file that only mentioned `pnpm test:db`; the workflow now runs the existing fail-closed DB smoke helper with `CI_REQUIRE_DB_SMOKE=true`, and the proof auditor requires captured `node:test` execution evidence for `pnpm test:db`.

## Evidence

- `.github/workflows/t1-proof-gate.yml`: adds Node/pnpm setup, dependency install, CI env materialization, and replaces C2 text-grep proof detection with `pnpm ci:db-smoke`.
- `.github/workflows/proof-auditor-gate.yml`: passes `--require-executed-command "pnpm test:db"` to `proof-auditor-gate.ts` for every changed proof directory.
- `scripts/ops/proof-auditor-gate.ts`: adds opt-in `--require-executed-command` validation that requires captured `node:test` pass output for a named command.
- `scripts/ops/proof-auditor-gate.test.ts`: adds regression coverage proving absent `pnpm test:db` evidence, string-only evidence, and skipped TAP output fail, while captured TAP proof with `# fail 0` and `# skipped 0` passes.
- `apps/api/src/database-smoke.test.ts`: inspected; no change required because `scripts/ci/required-db-smoke.ts` already converts skipped DB smoke tests into a failure when required.

Proof capture HEAD: `1ad3ed6e8551ec05b635e26ff5bef4ca79a582ef`

## Verification

- `pnpm type-check`: PASS
- `npx tsx --test scripts/ops/proof-auditor-gate.test.ts`: PASS, 16 tests, 0 failed, 0 skipped
- `pnpm test:db`: PASS, 7 tests, 0 failed, 0 skipped
- `pnpm test`: PASS
- `pnpm verify`: PASS
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS, changed files 16, no matched R-level rules
