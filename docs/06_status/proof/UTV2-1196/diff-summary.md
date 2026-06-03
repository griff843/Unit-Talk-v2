## Summary

UTV2-1196 makes the T1 proof gate execution-bound for live DB smoke coverage. The previous C2 check accepted a proof file that only mentioned `pnpm test:db`; the workflow now runs the existing fail-closed DB smoke helper with `CI_REQUIRE_DB_SMOKE=true`.

## Evidence

- `.github/workflows/t1-proof-gate.yml`: adds Node/pnpm setup, dependency install, CI env materialization, and replaces C2 text-grep proof detection with `pnpm ci:db-smoke`.
- `scripts/ops/proof-auditor-gate.ts`: adds opt-in `--require-executed-command` validation that requires captured `node:test` pass output for a named command.
- `scripts/ops/proof-auditor-gate.test.ts`: adds regression coverage proving a string-only `pnpm test:db` proof fails and a captured TAP proof with `# fail 0` and `# skipped 0` passes.
- `apps/api/src/database-smoke.test.ts`: inspected; no change required because `scripts/ci/required-db-smoke.ts` already converts skipped DB smoke tests into a failure when required.

Proof capture HEAD: `e71f66dd8d18547119444c7aa74b4aefa7da43ae`

## Verification

- `pnpm type-check`: PASS
- `npx tsx --test scripts/ops/proof-auditor-gate.test.ts`: PASS, 14 tests, 0 failed, 0 skipped
- `pnpm test`: PASS
- `pnpm verify`: PASS
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS, no matched R-level rules
