# UTV2-1411 Verification

## Verification

| Check | Result |
| --- | --- |
| `pnpm type-check` | Passed — TypeScript project references completed without errors. |
| `pnpm test` | Passed — root aggregate test suite completed successfully. |
| `pnpm test:db` | Passed — live database repository smoke test passed (1 test, 0 failures). |
| `git diff --check origin/main...HEAD` | Passed — no whitespace errors. |
| Model-routing validation | Passed — `jq -e` confirmed issue ID, schema version, selected model/profile, medium reasoning effort, no legacy compatibility or override, and exit code `0`. |

`pnpm test:db` node:test result:

```text
1..1
# tests 1
# pass 1
# fail 0
# skipped 0
```

## Issue-specific verification

The branch diff against `origin/main` is limited to lane/sync metadata and UTV2-1411 proof artifacts. The required `model-routing.json` is present and structurally validates with the expected UTV2-1411 routing values.

The additional live-DB smoke run passed to satisfy the proof auditor's executed-command requirement, although this T2 lane does not modify `supabase/migrations/**`, `packages/db/**`, or an API service.

## Commit binding

Evidence was captured for commit `cedcf59d0a05e6a1caf1dfc418a6c80ab1874ed9`.
