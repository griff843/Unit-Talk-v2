# UTV2-1494 — Verification

## Summary

Spec-only T1 governance lane. Diff is docs-only (`docs/05_operations/MECHANICAL_TIER_CLASSIFIER_SPEC.md`) — no code, workflow, or runtime path is touched. Per the T1 proof standard (`docs/05_operations/EVIDENCE_BUNDLE_TEMPLATE.md`), `pnpm test:db` is required as a live-DB health/runtime proof regardless of whether the diff itself touches runtime code, so it was run for real against the live Supabase project and its raw TAP output is embedded below.

## Verification

**Required executed command: pnpm test:db**

Command: `pnpm test:db` (`tsx --test apps/api/src/database-smoke.test.ts`)
Environment: live Supabase project `zfzdnfwdarxucxtaojxm`
Run at: 2026-07-09T00:15:00Z (worktree `claude__utv2-1494-mechanical-tier-classification`, commit `45df155bf8c4df6f839e93da9ac9b7d85ada4c7c`)

Note: this is the branch-head commit SHA at the time this proof was written, not the eventual merge SHA (which does not exist yet). Post-merge, `ops:proof-generate --merge-sha` rebinds `docs/06_status/proof/UTV2-1494/evidence.json`'s `sha_binding` to the true merge SHA per the standard proof-SHA-binding flow; this file documents the pre-merge PR-time verification run.

Raw TAP output:

```
> @unit-talk/v2@0.1.0 test:db /home/griff843/code/Unit-Talk-v2/.out/worktrees/claude__utv2-1494-mechanical-tier-classification
> tsx --test apps/api/src/database-smoke.test.ts

TAP version 13
# Subtest: database repository bundle persists a submission and settlement when Supabase is configured
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
  ---
  duration_ms: 18387.646351
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
  ---
  duration_ms: 17336.406094
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
  ---
  duration_ms: 16714.757484
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
  ---
  duration_ms: 16818.600553
  type: 'test'
  ...
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
  ---
  duration_ms: 860.383583
  type: 'test'
  ...
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
  ---
  duration_ms: 21340.369672
  type: 'test'
  ...
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
  ---
  duration_ms: 18584.416196
  type: 'test'
  ...
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 110736.467733
```

## Live-DB proof

In addition to `pnpm test:db` passing green (7/7, 0 fail, 0 skipped) against real Supabase, a direct read was run against the `picks` table in project `zfzdnfwdarxucxtaojxm` to confirm monitored-table health:

```sql
select count(*) as row_count from picks;
```

Result: 1 row, `row_count = 63850`.

## Does NOT claim

This lane does not claim any runtime/feature behavior change was verified — the diff is docs-only (the tier-classifier spec document). The `pnpm test:db` run and the `picks` row-count read above are environment-health proof satisfying the T1 mandatory live-DB proof standard, not evidence that spec content itself was exercised at runtime (there is no runtime surface for a specification document).

## Other static checks

- `pnpm verify` — PASS (green, full suite, commit `45df155b`)
- `scripts/ci/r-level-check.ts --base origin/main --head HEAD` — verdict PASS, 4 changed files, no R-level artifacts required (no rule in `docs/05_operations/r1-r5-rules.json` matched this docs-only diff)

See also `docs/06_status/proof/UTV2-1494/evidence.json` for the machine-readable evidence bundle.
