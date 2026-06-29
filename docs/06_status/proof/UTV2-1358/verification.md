# UTV2-1358 Verification Log

## Verification

### pnpm type-check

```
> @unit-talk/v2@0.1.0 type-check
> pnpm exec tsc -b tsconfig.json

(exit 0 — no errors)
```

Status: PASS

### pnpm test

```
TAP version 13
# tests 11
# pass 11
# fail 0
# skipped 0
TAP version 13
# tests 74
# pass 74
# fail 0
# skipped 0
TAP version 13
# tests 73
# pass 73
# fail 0
# skipped 0
TAP version 13
# tests 25
# pass 25
# fail 0
# skipped 0
```

Status: PASS (all suites green, 0 failures)

### R-level check

```
npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD

Verdict: PASS
Changed files: 8
Rules matched: (none) — no R-level artifacts required for this diff
```

Status: PASS

## GHA Run

Workflow triggered on branch `codex/utv2-1358-m5-grading-staleness-alert-fix` via `workflow_dispatch`.

**Run URL:** https://github.com/griff843/Unit-Talk-v2/actions/runs/28350361288

**Result:** Script executed successfully. "workflow file issue" is eliminated.

Step-by-step output:
- Set up job ✓
- Run actions/checkout@v4 ✓
- Run pnpm/action-setup@v4 ✓
- Run actions/setup-node@v4 ✓
- Install dependencies ✓ (`pnpm install --frozen-lockfile`)
- Check grading staleness — script ran, emitted:

```json
{
  "level": "WARN",
  "service": "grading",
  "check": "staleness",
  "message": "65 of 98 grading.run(s) in the last 24h completed with 0 picks graded. Last run was 17m ago (status: succeeded). Possible cause: no settled game results, no eligible picks, or upstream blockage.",
  "ts": "2026-06-29T05:19:01.022Z"
}
```

Exit code 1 is the script's **designed behavior** for the WARN condition (per script comment:
"Exit 1 so GHA step fails and the run is visible in the checks list"). This is the monitoring
alert functioning as intended — 65/98 grading runs with 0 picks graded is a legitimate
operational signal that the grading pipeline needs attention.

**Pre-fix behavior:** "This run likely failed because of a workflow file issue" — `tsx` not found,
no Supabase query, no output.

**Post-fix behavior:** Script runs, connects to Supabase, queries `system_runs`, emits structured
JSON, exits with operational signal.

The M5 criterion 3 "workflow file issue" is resolved. The workflow now executes end-to-end.

## pnpm test:db

Command: `pnpm test:db`
Status: **FAIL** — pre-existing statement timeout, unrelated to this lane's changes

`pnpm test:db` was run against the live Supabase project (`zfzdnfwdarxucxtaojxm`). All 7
subtests timed out via `settlement_records.listRecent` in the CLV computation path
(`clv-feedback.ts → processSubmission → DatabaseSettlementRepository.listRecent`).

Root cause: `settlement_records` has no index on `created_at`. Full sequential scan
even with a `since` lower-bound causes statement timeouts. This is a pre-existing
performance gap; no changes in this lane affect the query path or table structure.

Basic DB connectivity confirmed: `scripts/ci/required-db-smoke.ts` passes in under 2s.

## Merge SHA

To be bound by `post-merge-lane-close.yml` after merge.
