# UTV2-1585 verification

## Summary

The Merge Gate workflow now owns one canonical custom check per PR and exact
head SHA. The native Actions job uses the distinct `Merge Gate Evaluator`
identity, and repeated policy events update the canonical check in place.

## Evidence

- Substantive implementation commit: `63095cf585989b94b3361bd8c5c3e4f3a1ffc830`
- Pull request: #1305
- Focused workflow-hardening result: 43 tests, 43 pass, 0 fail, 0 skipped
- Live database smoke result: 7 tests, 7 pass, 0 fail
- R-level result: PASS, no matching rules
- File-scope result: PASS

## Verification

The following commands were executed on the substantive branch head:

- `npx tsx --test scripts/ops/workflow-hardening.test.ts`
- `pnpm type-check`
- `pnpm lint`
- `pnpm test`
- `pnpm test:db`
- `pnpm verify`
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`
- `npx tsx scripts/ci/file-scope-guard.ts --base origin/main --head HEAD --branch codex/utv2-1585-merge-gate-canonical-check-identity`

```text
Focused workflow hardening
1..43
# tests 43
# pass 43
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

R-level
Verdict: PASS
Rules matched: none
```

The T1 live-proof battery also completed with zero failures. One bounded
provider-history assertion skipped because the latest provider snapshot was
older than its lookback window; the test explicitly classifies that condition
as stale provider data, not a code regression.
