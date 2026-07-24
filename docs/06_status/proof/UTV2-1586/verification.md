# UTV2-1586 verification

## Summary

The post-merge lane closer can now bind a missing implementation PR only from
the exact trusted workflow context. It resolves and validates the original PR
before mutation, rolls back partial repair state on failure, and completes
terminal sync/lease/mutex/worktree cleanup on success.

## Evidence

- Final substantive implementation commit: `9a2dba7726514a2f5ba7e5515fd7b8393b214b20`
- Transaction hardening: rollback now snapshots coordination state before
  auto-acquiring the merge mutex, preventing failed repair ghost capacity
- Focused lane-close result: 108 tests, 108 pass, 0 fail, 0 skipped
- Focused workflow-hardening result: 44 tests, 44 pass, 0 fail, 0 skipped
- Live database smoke result: 7 tests, 7 pass, 0 fail
- Manifest validation: PASS (`manifest_valid`)
- Diff check: PASS
- R-level result: PASS

## Verification

The following commands were executed on the substantive branch head:

- `npx tsx --test scripts/ops/lane-close.test.ts`
- `npx tsx --test scripts/ops/workflow-hardening.test.ts`
- `pnpm type-check`
- `pnpm lint`
- `pnpm test`
- `pnpm test:db`
- `pnpm test:t1-proof:live`
- `pnpm verify`
- `npx tsx scripts/ops/lane-manifest.ts validate UTV2-1586 --json`
- `pnpm ops:proof-check UTV2-1586 --json`
- `git diff --check`
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`

```text
Focused lane close
1..108
# tests 108
# pass 108
# fail 0
# skipped 0

Focused workflow hardening
1..44
# tests 44
# pass 44
# fail 0
# skipped 0

Live database smoke
1..7
# tests 7
# pass 7
# fail 0
# skipped 0

pnpm verify
exit 0

Manifest validation
{"ok":true,"code":"manifest_valid","errors":[]}

JSON evidence bundle
Verdict: PASS

R-level
Verdict: PASS
```

The broader T1 live-proof battery completed with zero failures. One bounded
provider-history assertion skipped because the latest provider snapshot was
older than its lookback window; the test explicitly classifies that condition
as stale provider data, not a code regression.

This is executor-produced evidence for independent review. It is not a PM
verdict, does not add `t1-approved`, and does not authorize merge.
