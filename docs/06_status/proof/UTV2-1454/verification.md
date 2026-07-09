# UTV2-1454 Verification

## Verification

- `npx tsx --test scripts/ops/preflight.test.ts` passed.
- `npx tsx --test scripts/ops/lane-start.test.ts` passed.
- `pnpm type-check` passed.
- `pnpm test` passed after rerunning a transient pre-existing branch-name collision in `scripts/codex-receive.test.ts`; the focused rerun of that file passed and the full rerun passed.
- `pnpm verify` passed.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` passed.

## Issue-Specific Verification

- Confirmed preflight source coverage for:
  - explicit `--docs-only-fast-path` opt-in
  - T3-only restriction
  - fail-closed file-scope validation
  - allowed `docs/06_status/**` paths
  - allowed `.claude/commands/*.md` paths
  - PB1/PB2 skip messages that still require CI and `pnpm verify` before PR
- Confirmed lane-start source coverage for:
  - explicit `--docs-only-fast-path` opt-in
  - T3-only restriction
  - current preflight token validation
  - allowed docs/status command paths
  - no worktree, manifest, lease, sync, or proof scaffold on validated fast-path starts

## Verify Notes

- `pnpm verify` also ran the live DB suite successfully.
- One live proof assertion skipped because the latest `provider_offer_history` row was older than the 72-hour lookback window; this is stale provider data, not a code regression.

## Post-Review Fixes (commit fc2ad838)

Two P2 findings from Codex review, fixed before requesting merge review:

- `scripts/ops/lane-start.ts`: the docs-only fast-path success return relied
  solely on the earlier preflight PL6 overlap result. A preflight token
  remains usable after generation, so another lane could lock one of the
  same docs/status files in the window between preflight and this command
  running, and the fast path would still emit success with no manifest or
  lease. Fixed by rechecking `activeManifestOverlap(issueId, normalizedFiles)`
  against current manifest state immediately before returning, failing
  closed with `file_scope_conflict` on overlap — same code and shape the
  normal lane-start path already uses.
- `.claude/commands/dispatch.md` / `.claude/commands/lane-management.md`:
  fast-path examples showed `--files <path>...`, but `parseArgs` only
  consumes the next token as a flag's value; additional space-separated
  paths silently become ignored positionals rather than additional files.
  Fixed all occurrences to explicit repeated `--files <path1> --files
  <path2>` flags with an inline note on the pitfall.

Verification after the fixes:
- `npx tsx --test scripts/ops/lane-start.test.ts scripts/ops/preflight.test.ts` passed (18 assertions, including a new source-contract test asserting the overlap recheck happens inside the docs-only fast-path block, after the preflight-token check and before the success emit).
- `pnpm type-check` passed.
- `pnpm verify` passed (full suite, including live-DB and T1-proof suites).
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` passed at both the pre-fix SHA (3366d881) and the post-fix SHA (fc2ad838).

## R-Level Compliance

```text
Verdict: PASS
Changed files: 14
Rules matched: (none) - no R-level artifacts required for this diff
```
