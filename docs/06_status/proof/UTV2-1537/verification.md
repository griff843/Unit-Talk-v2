# PROOF: UTV2-1537
MERGE_SHA: not-yet-merged. This branch's implementation commit at proof-authoring time: `0d84666f26d95dab10d9498ad0f78f4fea0a44ca` (see evidence.json's `sha_binding.verified_source_sha`). The real merge SHA will be populated post-merge via `ops:proof-generate --merge-sha`, per this repo's standard closeout automation.

ASSERTIONS:
- [x] Truthful incident record created at `docs/06_status/INCIDENTS/INC-2026-07-14-utv2-1533-direct-main-push.md`, every fact independently re-verified via `git`/`gh` before writing (no fact taken on trust from the task brief)
- [x] Incident record states plainly that no emergency exception was recorded before the unauthorized push -- no pre-authorization is invented
- [x] `docs/06_status/INCIDENTS/README.md` index updated, newest entry first
- [x] Root cause identified: an immediate cause (a fail-closed gate correctly rejecting missing T1 runtime proof) plus 3 contributing causes -- no governed repair path existed, `enforce_admins: false` on branch protection (verified via `gh api repos/griff843/Unit-Talk-v2/branches/main/protection`), and this is an unlogged recurrence of a 2026-07-10 precedent
- [x] A compliant, additive-only repair path (`scripts/ops/proof-repair.ts`) was designed and implemented -- never writes to `main`, never fabricates runtime evidence, never overwrites an already-bound merge SHA, never destructively clobbers hand-authored proof narrative
- [x] A mechanical detection guard (`scripts/ci/direct-main-push-guard.ts`) was designed and implemented, with an explicit, honest statement of what it can and cannot verify from repo/GitHub-API-visible signals alone

## Verification

- [x] `pnpm type-check`: PASS (0 errors; note -- `scripts/` is outside `tsconfig.json`'s project-reference build graph in this repo, a pre-existing condition, not something this lane introduced or relies on to hide an error. Both new files were additionally checked with a standalone strict `tsc --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes` pass matching `tsconfig.base.json`'s real settings, with zero genuine errors after two real bugs were found and fixed this way -- see Commit history below)
- [x] `pnpm lint`: PASS (0 errors on the full repo, including all new/changed files)
- [x] `pnpm test`: PASS (full suite, including live-DB-touching suites embedded in `pnpm test` such as UTV2-1136/UTV2-1327/UTV2-1459's live assertions)
- [x] `pnpm test:ops`: PASS -- 956/956 tests, 0 failures (includes the 130 targeted new/changed tests below plus every other `scripts/ops` + `scripts/ci` test file in the repo)
- [x] `npx tsx --test scripts/ops/proof-repair.test.ts scripts/ci/direct-main-push-guard.test.ts scripts/ops/truth-check-lib.test.ts scripts/ops/lane-close.test.ts`: PASS -- 130/130

```
$ pnpm test:ops
...
1..944
# tests 956
# suites 6
# pass 956
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

- [x] `pnpm verify` (full): PASS -- ran green on this branch (env:check, lint, type-check, build, test) before the runtime-proof capture below
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS -- Verdict: PASS, Changed files: 16, Rules matched: (none)

## Runtime Verification

```
$ pnpm test:db
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
# Subtest: UTV2-996: re-settling a settled pick creates correction -- no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction -- no true duplicate base rows
# Subtest: UTV2-996: correction chain is additive -- original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive -- original settlement row is not mutated
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Ran against the live `zfzdnfwdarxucxtaojxm` Supabase project (real credentials from `local.env`, not an in-memory repository). Full query/row-count evidence in `evidence.json`'s `runtime_proof` block. Live monitored-table row counts (via `mcp__claude_ai_Supabase__execute_sql`, captured immediately after the run above):

| table | count |
|---|---|
| picks | 74191 |
| pick_lifecycle | 110204 |
| submissions | 76270 |
| distribution_outbox | 4971 |
| audit_log | 195400 |
| settlement_records | 24730 |

This lane's own diff (governance docs + TypeScript ops/ci tooling) does not itself touch any of these tables or any DB code. This runtime proof exists because `tier === 'T1'` makes `truth-check-lib.ts`'s `runtime_proof_required` gate unconditional, regardless of whether the diff's own files touch DB paths -- the exact same fact this lane's own incident record documents about the lane whose closeout this incident occurred during.

## Commit history (this branch)

- `dba76f18` (amended to `0d84666f` after a self-caught Branch Discipline Guard violation -- see below) -- implementation commit: incident record, README index update, `DIRECT_MAIN_BYPASS_POLICY.md` cross-reference, `post-merge-lane-close.yml` + `lane-close.ts` remediation-message update, `scripts/ops/proof-repair.ts` + tests, `scripts/ci/direct-main-push-guard.ts` + tests, `truth-check-lib.ts`'s `classifyRuntimeProofGap` + tests, lane manifest, sync file.
- Self-caught issue during authoring: the first draft of the implementation commit message spelled out this incident's filename (`INC-2026-07-14-utv2-1533-direct-main-push.md`) in a "Full write-up" pointer line, which embeds the literal token `UTV2-1533` and would have failed Branch Discipline Guard (`multiple_issue_references`). Caught by running `pnpm ops:branch-discipline` locally against the drafted message before pushing, and fixed via `git commit --amend` (safe here -- purely local, not yet pushed) to reference "this lane's own new file under docs/06_status/INCIDENTS/" instead of spelling the filename.
- Two real type-safety bugs were found and fixed in `scripts/ci/direct-main-push-guard.ts` during a standalone strict `tsc` pass beyond what this repo's actual `pnpm type-check` currently reaches (`scripts/` is outside the `tsconfig.json` project-reference graph): a `noUncheckedIndexedAccess` regex-capture-group access and an indexed-lookup that could be `undefined`. Both fixed with explicit fallbacks (`match?.[1] ?? null`, `KNOWN_AUTOMATION_IDENTITIES[authorLogin] ?? []`).
- One real logic bug was found and fixed via the test suite itself: `emergencyRecordReferencesSha`'s path-containment check compared a caller-supplied `root`-relative path against a module-level constant computed from this repo's own real root, so it always failed for any non-default `root` (e.g. every test). Fixed to compute the INCIDENTS directory boundary relative to the same `root` parameter the function was actually given.
- Two test assertions were over-broad on first pass (matching the literal substring `--admin` even inside this module's own explanatory prose warning against it, e.g. "never `--admin`, never a direct push") and produced false failures against genuinely-correct code; narrowed to match only an actual `merge --admin` invocation shape, plus (for the design-invariant test) the stronger structural check that `proof-repair.ts` never imports `node:child_process` at all.

## Merge SHA reference

Not applicable yet -- **the PR is not merged.** No merge SHA is invented here (`evidence.json`'s `sha_binding.merge_sha` stays `null`). Will be populated post-merge via `ops:proof-generate --merge-sha`, per this repo's standard closeout automation (the same narrowly-scoped, `SYNC_BOT_TOKEN`-authorized bot mechanism this lane's own incident record and `proof-repair.ts` explicitly do not attempt to replicate for evidentiary content).
