# PROOF: UTV2-1537
MERGE_SHA: 0d84666f26d95dab10d9498ad0f78f4fea0a44ca

Not yet merged -- the SHA above is this branch's own implementation commit (an
ancestor of the current PR head), per the same implementation-commit-as-ancestor
pattern `executor-result-validator.yml` documents for pre-merge proof. See
`evidence.json`'s `sha_binding.verified_source_sha` for the same value. The real
merge SHA will be populated post-merge via `ops:proof-generate --merge-sha`, per
this repo's standard closeout automation.

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
- [x] `pnpm test:ops`: PASS -- 958/958 tests, 0 failures (includes the 132 targeted new/changed tests below plus every other `scripts/ops` + `scripts/ci` test file in the repo)
- [x] `npx tsx --test scripts/ops/proof-repair.test.ts scripts/ci/direct-main-push-guard.test.ts scripts/ops/truth-check-lib.test.ts scripts/ops/lane-close.test.ts`: PASS -- 132/132

```
$ pnpm test:ops
...
1..946
# tests 958
# suites 6
# pass 958
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

- [x] `pnpm verify` (full): PASS -- ran green on this branch (env:check, lint, type-check, build, test) before the runtime-proof capture below
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS -- Verdict: PASS, Changed files: 16, Rules matched: (none)

## Runtime Verification

EVIDENCE:
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
- A real, pre-existing, unrelated bug was discovered via this PR's own Lane Authority Check failure: `.lane/lanes/governance.yml` allow-lists `docs/06_status/incidents/**` (lowercase), but the real directory has always been `docs/06_status/INCIDENTS/` (uppercase); `micromatch.isMatch()` in `scripts/lane-contract.ts` is case-sensitive, so that glob never matched anything real. A one-line casing fix was attempted, then correctly rejected by `file-scope-guard.ts`'s anti-gaming design (a lane manifest's `file_scope_lock` is locked to the first commit that introduced it, specifically so a PR cannot widen its own declared scope after the fact -- only a human-authorized `scope-override/v1` PR comment can, and this lane has no authority to post one on its own behalf). The fix was reverted; the bug remains real, confirmed, and reported for PM judgment (a `scope-override/v1` comment on this PR, or a separate follow-up fix) -- `Lane authority` is not among branch protection's required contexts and does not block merge, so this is a known gap, not a blocker.
- A prior draft of the T1 proof bundle pointed `Proof Artifact:` at `evidence.json` (a JSON file) and had a `MERGE_SHA:` line with trailing prose after the SHA; `executor-result-validator.yml` requires the referenced proof file to literally contain `# PROOF:`, a bare-hex `MERGE_SHA:` line, `ASSERTIONS:`, and `EVIDENCE:` (with ≥2 fenced code blocks). Fixed by pointing at `verification.md` (which already had most of this shape) and adding the missing `EVIDENCE:` label; caught before merge by locally replicating the validator's own regex checks against the file rather than waiting for CI to fail again.
- The first `executor-result/v1` comment had two further self-caught errors: a transcribed (not command-substituted) `Head SHA` that silently differed from the real HEAD by several characters despite an identical-looking prefix, and posting before `pnpm verify`'s CI run had actually completed (the validator explicitly checks for this and fails closed with "CI check is in_progress, not completed"). Both fixed by re-deriving the SHA via `$(git rev-parse HEAD)` instead of copying displayed output, and by waiting for `verify` to reach a terminal state before re-posting.

## Codex review round 1 — addressed

A fresh Codex review triggered after CI stabilized (2 passes: one on an interim push, one re-triggered by an explicit `@codex review` comment after all CI fixes landed) surfaced 4 distinct findings (2 of the 4 were restated across passes as duplicate inline threads):

- **P1, real, fixed** -- `direct-main-push-guard.yml`'s `permissions:` block only granted `contents: read`, but `gatherCommitInput()` calls `commits/{sha}/pulls`, which GitHub's own REST docs list as requiring `Pull requests: read`. Without it every ordinary human-authored PR merge on `main` would be misclassified `unauthorized_direct_push`. Added `pull-requests: read`.
- **P2, real, fixed** -- the workflow only classified the push's head SHA, missing any earlier unauthorized commit in a multi-commit push. Changed to classify the full `github.event.before..github.sha` range (with a guard for a zero/non-ancestor before-SHA falling back to head-only), and increased checkout `fetch-depth` to `0` so the range is actually reachable.
- **P2, real, fixed** -- `authorized_automation` classified purely on identity + commit-message pattern, never checking which files were actually touched; a compromised or buggy automation reusing an allow-listed subject line could stage arbitrary files and still be trusted. Extended the allow-list entries with `changedPathGlobs`, added `changedFiles` to the classifier input (gathered via `git show --name-only` in the CLI wrapper), and require every changed file to match the operation's known scope -- a message-pattern match with no changed-files evidence, or with any out-of-scope file, now falls through to `unauthorized_direct_push` instead.
- **P2, real, fixed** -- `proof-repair.ts`'s scaffold told the operator to run a raw `git worktree add -b ...`, but `AGENTS.md` (line 12) requires executable lanes to start through `pnpm ops:lane-start` so `worktree_path` is recorded, the file-scope lock is reserved, and the lane cwd is verified. Rewrote the scaffold to generate a preflight token then call `pnpm ops:lane-start`, matching the canonical lane-start convention this repo's own dispatch tooling uses.

All 4 fixes shipped with tests (6 new/updated tests in `direct-main-push-guard.test.ts`, 1 new assertion in `proof-repair.test.ts`'s scaffold test) -- see the updated targeted-suite count above (130 → 132). No findings were deferred; all were in this PR's own remit.

## Merge SHA reference

Not applicable yet -- **the PR is not merged.** No merge SHA is invented here (`evidence.json`'s `sha_binding.merge_sha` stays `null`). Will be populated post-merge via `ops:proof-generate --merge-sha`, per this repo's standard closeout automation (the same narrowly-scoped, `SYNC_BOT_TOKEN`-authorized bot mechanism this lane's own incident record and `proof-repair.ts` explicitly do not attempt to replicate for evidentiary content).
