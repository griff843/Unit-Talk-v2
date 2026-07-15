# PROOF: UTV2-1541
MERGE_SHA: de98cf63add5c48d05ac59df8ef450d4742db161

ASSERTIONS:
- [x] `AGENTS.md` added to `.lane/lanes/governance.yml`'s `allowed_path_globs`
- [x] `docs/06_status/INCIDENTS/**` (case-correct, uppercase) added to the same allowlist; the pre-existing lowercase `docs/06_status/incidents/**` entry is left in place (additive only, no removals)
- [x] 5 new tests in `scripts/lane-contract.test.ts` load the real `.lane/lanes/governance.yml` via `loadLaneManifest('governance')` (not a synthetic manifest) and prove: `AGENTS.md` accepted, `docs/06_status/INCIDENTS/...` accepted, legacy lowercase form still accepted, an unrelated path still rejected, and a mixed-case near-miss on the incidents path still rejected (matching stays case-sensitive)
- [x] `pnpm exec tsc -b tsconfig.json`, `pnpm lint`, `pnpm verify` (full), and the R-level check all pass clean
- [x] `pnpm test:db` passes against the live `zfzdnfwdarxucxtaojxm` Supabase project (7/7), satisfying the unconditional T1 `runtime_proof_required` gate
- [x] Diff is narrowly scoped to exactly the declared fix: `.lane/lanes/governance.yml` (2 new allowlist entries + explanatory comments) and `scripts/lane-contract.test.ts` (new tests) — no other governance.yml changes
- [x] No cross-issue UTV2-### references in commit subjects/bodies, PR title, or PR body — only UTV2-1541 appears

EVIDENCE:
```text
$ npx tsx --test scripts/lane-contract.test.ts
...
1..10
# tests 10
# suites 0
# pass 10
# fail 0
# cancelled 0
# skipped 0
# todo 0

$ pnpm exec tsc -b tsconfig.json
(exit 0, no diagnostics)

$ pnpm lint
(exit 0, no problems)

$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 3
Rules matched: (none) — no R-level artifacts required for this diff

$ pnpm verify:quick
[sync-check] OK (per-issue): branch "claude/utv2-1541-lane-authority-allowlist-fix" <-> .ops/sync/UTV2-1541.yml
[system-alignment] verdict=PASS fail=0 warn=0
[automation-coverage] verdict=PASS fail=0 warn=0 classified=15
Environment files passed validation.
(lint: exit 0, type-check: exit 0)
```

## Verification

All static and runtime verification for this diff is green: `pnpm exec tsc -b tsconfig.json`,
`pnpm lint`, `scripts/lane-contract.test.ts` (10/10), `pnpm verify` (full), the
R-level check, and `pnpm test:db` against the live Supabase project all pass.
Details for each are in the EVIDENCE block above and the Runtime verification
section below.

## Runtime verification (T1 — unconditional per `truth-check-lib.ts`'s `runtime_proof_required` gate)

Command: `pnpm test:db` (`tsx --test apps/api/src/database-smoke.test.ts`) against the
live `zfzdnfwdarxucxtaojxm` Supabase project.

```
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

Live row counts captured immediately after (via `mcp__claude_ai_Supabase__execute_sql` against
project `zfzdnfwdarxucxtaojxm`, `SELECT COUNT(*)`), 2026-07-15T06:59:00Z:

| table | row_count |
|---|---|
| picks | 75,288 |
| pick_lifecycle | 111,800 |
| submissions | 77,248 |
| distribution_outbox | 5,102 |
| audit_log | 197,616 |
| settlement_records | 25,220 |

This diff's own scope (`.lane/lanes/governance.yml` control-plane config +
`scripts/lane-contract.test.ts`) has no DB dependency — this runtime proof exists
to satisfy the unconditional T1 `runtime_proof_required` gate, not because the
diff itself touches database code.

## Why this fix is correct

`scripts/lane-contract.ts`'s `matchesAny()` calls `micromatch.isMatch(file, patterns, { dot: true })`
with no `nocase` option, so glob matching is case-sensitive. The pre-existing
`docs/06_status/incidents/**` entry (lowercase, added UTV2-1524) never matched
this repo's actual incident-log directory, `docs/06_status/INCIDENTS/**`
(uppercase) — confirmed by `docs/06_status/INCIDENTS/INC-2026-04-10-utv2-519-...md`,
which predates this fix by three months and has always used the uppercase form.
`AGENTS.md` was never in the allowlist at all. Both gaps caused real Lane
Authority failures on PR #1218 (UTV2-1536, editing `AGENTS.md`) and PR #1219
(UTV2-1537, editing `docs/06_status/INCIDENTS/*.md`).

## SHA Binding

Branch: claude/utv2-1541-lane-authority-allowlist-fix
Head SHA (at authoring time): de98cf63add5c48d05ac59df8ef450d4742db161
Merge SHA: not yet merged — will be bound by `post-merge-lane-close.yml`'s automated
`ops:proof-generate --merge-sha` run after this PR merges, per this repo's standard T1
closeout automation.
