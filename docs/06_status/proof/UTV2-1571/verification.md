# PROOF: UTV2-1571

| Field | Value |
| --- | --- |
| Issue | UTV2-1571 |
| Tier | T1 |
| Branch | claude/utv2-1571-file-scope-lock-history-separation |
| Commit SHA(s) | `a192cd78f649131e0716578713c2ca3bc1c0bb06` (actual merge commit -- this repair PR builds directly on it) |

MERGE_SHA: a192cd78f649131e0716578713c2ca3bc1c0bb06

(This SHA is the core-fix commit, an ancestor of this proof commit and of the
PR's eventual merge commit — used here to satisfy proof/merge-SHA binding
without a circular self-reference. The real merge SHA is additionally
recorded post-merge by the standard `ops:proof-generate --merge-sha`
closeout step, which rewrites the "Commit SHA(s)" row above and the
"Merge SHA Binding" section below to the true merge SHA — see
`rebindVerificationMdSha` in `scripts/ops/proof-generate.ts`.)

## Verification

## Summary

Fixes the root cause blocking UTV2-1550 (and, downstream, UTV2-1560) from
releasing `package.json` file-scope capacity: `scripts/ci/file-scope-guard.ts`
conflated "is this PR's own diff allowed to touch these files" (which
legitimately needs `merged` status per UTV2-1563) with "does another lane's
declared scope block a different lane's diff" (which should not treat
`merged` as active once nothing is actively resuming it). Splits these into
two status sets: `SELF_SCOPE_STATUSES` and `LOCK_CONFLICT_STATUSES`.

This PR does **not** implement any new closeout/override mechanism for
UTV2-1550. It was descoped by explicit PM decision: an earlier iteration
built a `--override` CLI path with GitHub-comment-based authorization, but
that constituted new privileged-code-path scope creep beyond what the
underlying bug requires, so it was dropped entirely. See "UTV2-1550 status
after this PR" below for what remains and what a human/PM-reviewed action
would need to look like.

## ASSERTIONS:

- [x] `file_scope_lock` (declared-at-lane-start edit scope) is used for both self-scope resolution and conflict-blocking, exactly as before
- [x] `files_changed` (immutable historical record) is read by neither role, in either the guard or truth-check's S1/G5 checks — unchanged, verified by a dedicated regression test
- [x] A manifest at status `merged` still resolves as its own trusted branch scope (UTV2-1563 behavior preserved)
- [x] A manifest at status `merged` no longer blocks a DIFFERENT lane's diff on an overlapping `file_scope_lock` path
- [x] A manifest at status `reopened` (a genuine resumed continuation) still blocks other lanes exactly as any other active lane would
- [x] `UTV2-1550`'s own manifest is untouched by this PR — `files_changed`, `file_scope_lock`, and `status: "merged"` all remain exactly as shipped by PR #1239
- [x] No manifest schema field was redefined in a way that breaks an existing reader (`file_scope_lock`'s `minItems: 1` and immutable-at-start semantics are unchanged for every existing consumer)
- [x] No override/authorization/mutex mechanism is added anywhere in this diff — confirmed via `git diff --stat origin/main` showing only `scripts/ci/file-scope-guard.ts`, `scripts/ci/file-scope-guard.test.ts`, `docs/05_operations/LANE_MANIFEST_SPEC.md`, plus this lane's own manifest/sync/proof files
- [x] 4 new unit tests added to `scripts/ci/file-scope-guard.test.ts` covering merged-historical-no-longer-blocks, merged-still-self-scopes, reopened-still-blocks, and files_changed-never-consulted — all pass (37/37 total in the file)
- [x] `pnpm type-check` PASS (full local run, as part of `pnpm verify`)
- [x] `pnpm test` PASS (full local run, as part of `pnpm verify`)
- [x] `pnpm test:db` PASS (7/7, live Supabase, as part of `pnpm verify`)
- [x] `r-level-check` PASS, no artifacts required for this diff (pure ops-tooling/CI-script change, matches no R1-R5 rule path)
- [x] Live, read-only `pnpm ops:truth-check UTV2-1550` run against this branch confirms `S1`/`G5` already pass on the real manifest, and the only 2 failures (`L3`, `G4`) are structural/pre-existing and unrelated to this fix

## EVIDENCE:

```text
$ npx tsx --test scripts/ci/file-scope-guard.test.ts
1..37
# tests 37
# suites 0
# pass 37
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

```text
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 5
Rules matched: (none) — no R-level artifacts required for this diff
```

```text
$ pnpm ops:truth-check UTV2-1550   (read-only; run against this branch to confirm the fix's effect and remaining gap)
[PASS] M1 - manifest found at docs/06_status/lanes/UTV2-1550.json
[PASS] M2 - manifest schema validated
[PASS] M3 - manifest.issue_id matches CLI argument
[PASS] M4 - manifest status merged is eligible
[PASS] M5 - manifest.pr_url is parseable
[PASS] M6 - manifest.commit_sha is set
[PASS] M7 - expected_proof_paths satisfies tier requirement
[PASS] L1 - Linear issue UTV2-1550 exists
[PASS] L2 - Linear tier label is t1
[FAIL] L3 - Linear state Blocked Internal is not In PM Review or Done
[PASS] L4 - Linear attachments include manifest.pr_url
[PASS] G1 - pull request is merged
[PASS] G2 - PR merge commit SHA matches manifest.commit_sha
[PASS] G3 - merge commit is reachable on main first-parent history
[FAIL] G4 - required checks missing or failing: Executor Result Validation, Merge Gate, P0 Protocol
[PASS] L5 - PR carries t1-approved label
[PASS] S1 - all files_changed are within file_scope_lock or proof paths
[PASS] G5 - no post-merge touches without linked follow-up issue detected
VERDICT: fail (43 checks, 2 failures)
```

```text
$ pnpm verify
(full local run — lint, type-check, build, test suite, test:db — exit code 0)
```

## Merge SHA Binding

Branch: claude/utv2-1571-file-scope-lock-history-separation
Merge SHA: pending — rebound automatically by `ops:proof-generate --merge-sha`
during post-merge lane-close reconciliation (`post-merge-lane-close.yml`).
This heading and the "Commit SHA(s)" row above are the two markers
`rewriteVerificationMdLines` (`scripts/ops/proof-generate.ts`) looks for; both
are present so the rebind is not a no-op.
PR: https://github.com/griff843/Unit-Talk-v2/pull/1291

## UTV2-1550 status after this PR

**Not truth-closed by this PR, and this PR builds no mechanism to close it.**
UTV2-1550's manifest remains at status `merged`; `files_changed`/
`file_scope_lock` are untouched. The file-scope-guard fix in this PR only
stops UTV2-1550's still-`merged` manifest from blocking *other* lanes
(UTV2-1560 among them) from touching overlapping paths — it does not, and
cannot, make UTV2-1550's own truth-check pass.

**Why `ops:lane-close --repair-merged` (or any repair short of a new
mechanism) cannot close UTV2-1550:** its manifest already has a correct
`commit_sha`/`pr_url` (repaired earlier, PR #1248) — `--repair-merged` is a
no-op against it today. The live truth-check run above confirms the 2
remaining failures are structural, not repairable by re-running anything:

- **`G4`** requires CI-green on the merge commit's required checks. That
  merge commit (`1d555828eed109bfe3d33f8e9cc5caa1aa202db8`) shows only
  `skipped`/`failure` runs for `Executor Result Validation`, `Merge Gate`,
  and no run at all for `P0 Protocol` — because the PR's own purpose was
  renaming/re-scoping these exact required-check identities, so any
  post-merge re-evaluation of this historical commit runs under trigger
  conditions that no longer match. This is called "expected and harmless" in
  the PR's own merged incident doc
  (`docs/06_status/INCIDENTS/INC-2026-07-17-utv2-1550-stale-required-check-identity.md`,
  "One-time bootstrap note"). GitHub structurally cannot re-evaluate checks
  against a closed PR's merge commit under a since-renamed required-context
  mapping — no retry, re-run, or wait fixes this.
- **`L3`** requires Linear state `In PM Review` or `Done`; UTV2-1550 is
  currently `Blocked Internal` — a Linear-side workflow-state correction, not
  a code fix.

**What a manual, PM-reviewed action would need to look like**, since no
mechanical retry can satisfy `G4`: Griff (or another CODEOWNERS-level human,
via a governed path — never this agent, and never a direct-`main` edit)
would need to explicitly attest that `G4` is permanently unsatisfiable for
this specific historical merge SHA for the documented structural reason
above, and record that attestation directly on UTV2-1550's manifest (e.g. a
`docs/06_status/lanes/UTV2-1550.json` update, via its own governed lane/PR,
setting `status: "done"` with an explicit human-attributed closure note) —
paired with moving the Linear issue's state out of `Blocked Internal`. This
PR deliberately does not build a CLI flag, comment-authorization scheme, or
any other automated path to perform that attestation; the earlier attempt to
build one was PM-descoped as unnecessary new privileged-surface risk for a
one-time, one-issue reconciliation. Doing this by hand, once, with a real
named human attesting it in the commit/PR that changes UTV2-1550.json, is
lower-risk than adding new automation that could be pointed at any future
manifest.

**Ghost capacity already reconciled independently of manifest status**
(does not require this PR to merge first — already performed in this
session, prior to and unrelated to this PR's diff):
- Dispatch lease `.ops/leases/UTV2-1550.json`: already `status: "released"`.
- Three stale local worktrees for terminal UTV2-1550-related PRs
  (`claude/utv2-1550-executor-result-required-check-identity` — PR #1239,
  MERGED; `claude/utv2-1550-lane-close-repair` — PR #1248, MERGED;
  `claude/utv2-1550-scope-reconcile` — PR #1288, CLOSED) removed via
  `git worktree remove --force`, and their local branches deleted via
  `git branch -D`.
- The repo-global merge-lock (`.ops/merge-lock.json`) is not currently held
  for UTV2-1550.
- No `ops:health` flag currently references UTV2-1550.

## Owner boundary

T1 — CI gate logic and lane-lifecycle governance tooling. Requires the
`t1-approved` label and a valid Griff-authored `pm-verdict/v1` APPROVED
comment (or GitHub PR review approval) bound to the reviewed head. This
proof supplies neither.

## Addendum: lane-close manifest repair (2026-07-22)

Post-merge, `ops:lane-close --repair-merged` failed for this lane with `"Manifest has no pr_url to repair
from."` because `docs/06_status/lanes/UTV2-1571.json` was left with `pr_url: null` after PR #1291 merged
(`a192cd78`). This addendum documents the follow-up repair PR (`claude/utv2-1571-lane-close-repair`), which
sets only `pr_url` -- `commit_sha` and `status` are deliberately left for the real `ops:lane-close
--repair-merged` run (re-triggered after that PR merges) to derive authoritatively from GitHub's own merge
state, matching the `DIRECT_MAIN_BYPASS_POLICY.md`-sanctioned repair-branch pattern already used for PR #1248
(the equivalent UTV2-1550 repair).
