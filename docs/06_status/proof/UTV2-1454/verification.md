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

---

# PROOF: UTV2-1454

MERGE_SHA: db8ead8deb48bbd3de8473adaf59a02c61e6c8e3

## ASSERTIONS:

- [x] T3 fast-path class defined: diffs touching ONLY docs/status paths (`docs/06_status/**` or `.claude/commands/*.md`) skip worktree isolation, manifest/lease/sync creation, and truth-check closeout, while CI (verify, branch discipline, lane authority, merge gate) + tier label remain required
- [x] Fail-closed boundary: any non-docs path, missing `--files`, or non-T3 tier mechanically disqualifies the fast path (`validateDocsOnlyFastPath` / `isDocsOnlyFastPathFile` in `preflight.ts` and `lane-start.ts`) — not an executor self-declaration
- [x] Fast-path lane-start rechecks `activeManifestOverlap` against current manifest state immediately before returning success, instead of trusting only the earlier preflight PL6 result (fixes a lock-race window where a preflight token remains usable after generation)
- [x] All `--files` fast-path doc examples use repeated flags (`--files a --files b`), not space-separated paths after a single `--files`, since `parseArgs` only consumes the next token as a flag's value
- [x] `pnpm test:db` passes against live Supabase (project `zfzdnfwdarxucxtaojxm`) on this branch

## EVIDENCE:

```text
npx tsx --test scripts/ops/lane-start.test.ts scripts/ops/preflight.test.ts
# tests 18
# pass 18
# fail 0
# skipped 0
```

```text
pnpm test:db
> @unit-talk/v2@0.1.0 test:db
> tsx --test apps/api/src/database-smoke.test.ts

TAP version 13
# Subtest: database repository bundle persists a submission and settlement when Supabase is configured
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
```
