# PROOF: UTV2-1892

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-22T00:45:00.000Z
Issue: UTV2-1892
Tier: T1
Lane type: runtime
Branch: claude/utv2-1892-merge-gate-work-identity
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1570
Head SHA: d9d5a533bbdc61888b368677d8a8e5efd73d2a12
result: pass

## ASSERTIONS:

### The trusted-base parser admits a repo-minted WORK identity, and nothing else widens

Written under the final-packet review on PR 1556 (comment 5651878285), which reproduced the
blocker at the trusted base `e0c8f812db065035af952ceb5111e2bcd443fbbb`: `parseVerdict` with an
exact-head APPROVED body gave `Issue: WORK-2026091001 -> null` while the control
`Issue: UTV2-1889` parsed. The workflow checks out `pull_request.base.sha` and requires the
module from that checkout, so the workflow-only hunk on PR 1556 could not close it.

- [x] `scripts/ops/merge-gate-verdict.cjs:30` accepts `(?:UTV2|UNI|WORK)-\d+` on the `Issue:`
      line. The reviewer's probe, re-executed against this head: `WORK-2026091001` parses to
      `{verdict: APPROVED, issueId: WORK-2026091001, prNumber: 1556, headSha: ecb7daeaf…}`;
      `UTV2-1889` still parses (the control is unchanged); `BOOTSTRAP-1` is still `null`.
- [x] `.github/workflows/merge-gate.yml` extracts the issue id from the branch and from the
      title with `(?:utv2|uni|work)-\d+`, and the WFR-v2 validators' branch extraction
      (`grep -oiP '(utv2|uni|work)-\d+'`, upper-cased) carries the same alternation. All
      three hunks are byte-identical to the ones already independently reviewed on PR 1556.
- [x] **Author, PR-number and head-SHA validation are preserved.** The test loop
      `repository and legacy identity <id> retain exact-head PM approval checks` runs for
      `WORK-2026091001`, `UTV2-1501` and `UNI-42`: each passes with a matching PR and head,
      and each is refused at a stale head. `AUTHORIZED_REVIEWERS` is untouched, so a verdict
      from a non-CODEOWNERS author or a bot is refused exactly as before.
- [x] **No absent-identifier path is admitted.** Every verdict still declares an identifier;
      a body whose `Issue:` line carries any other namespace still parses to `null`.
- [x] **The two trusted copies cannot drift apart again.** The drift lock reads
      `merge-gate.yml` off disk, extracts the namespace alternation after each of the three
      markers, asserts all three equal `['UNI','UTV2','WORK']`, asserts `parseVerdict` admits
      each namespace, and asserts it refuses `BOOTSTRAP-`. Reverting the `.cjs` hunk alone
      fails two tests; reverting the `.yml` hunk alone fails one. The control that gates
      merges is no longer invisible to the suite.
- [x] **An identifier embedded in a longer token is not an identifier.** Under the independent
      review's blocking finding, all three workflow extractors are bounded at both ends:
      `feature/homework-123-fix`, `feature/work-123abc`, `feature/mywork-123` and the title
      `Fix homework-123` resolve to **nothing**, while `codex/work-2026091001-…`,
      `claude/utv2-1892-…`, `bootstrap/uni-42-…` and `UTV2-1892: …` still resolve. The test
      evaluates the two JS literals and the grep pattern as read from the workflow file, so it
      measures the operative expressions rather than a copy.
- [x] CODEOWNERS, branch protection, the required-check set, the T1 rule (`t1-approved` label
      **and** exact-head `pm-verdict/v1`), bounce limits and supersession order are unchanged.
      `git diff origin/main..HEAD --stat` is four source files plus the lane manifest and
      sync file.

### The file-scope guard recognises a repository-owned WORK identity

Added on readmission. The Merge Gate half above lets a `WORK-###` lane be *evaluated*; this
half lets it *pass*. `scripts/ci/file-scope-guard.ts` carried two UTV2-only identity
patterns, so `laneLifecycleScopePatterns()` returned `[]` for a WORK issue ID and the three
files `ops:lane-start` itself creates -- the lane's manifest, its sync file and its proof
directory -- were reported as cross-lane bleed on the lane's own PR. That is the identical
failure class already fixed once for UTV2 lanes: a lane could not pass a gate by doing
exactly what the lane procedure told it to do.

- [x] Both patterns now derive from one constant, `ISSUE_NAMESPACES = 'UTV2|UNI|WORK'`,
      matching the namespace set the executor-result validator already accepts. One
      definition, so the two cannot drift.
- [x] **The grant is still EXACT-LANE.** `laneLifecycleScopePatterns('WORK-2026092101')`
      returns exactly `.ops/sync/WORK-2026092101.yml`,
      `docs/06_status/lanes/WORK-2026092101.json` and
      `docs/06_status/proof/WORK-2026092101/**` -- no `docs/06_status/lanes/**` and no
      `.ops/sync/**` directory exemption. A WORK lane carrying another lane's manifest,
      sync file or proof still fails, and the test asserts all three refusals by file.
- [x] **No path scope is widened.** A WORK lane's ordinary files are still checked against
      its `file_scope_lock` exactly as a UTV2 lane's are.
- [x] **Conflict detection works in both directions.** An active WORK lane's lock blocks a
      UTV2 lane touching the same path, and an active UTV2 lane's lock blocks a WORK lane.
      Being recognised does not mean being exempt.
- [x] **The namespace set is closed, and the refusal is fail-closed.** Nine rejected inputs
      are pinned -- `BOOTSTRAP-1`, `FOO-1`, `WORK-abc`, `WORK-123abc`, `HOMEWORK-123`,
      `WORK`, `''`, `null`, `undefined` -- each receiving an empty grant, not a wide one.
      `bootstrap/*` keeps its own separate, dedicated authorization mechanism
      (`scripts/ops/bootstrap-authorization.ts`); it is not silently admitted here.
- [x] **`tracker_ref` semantics are not widened.** `WORK` is repository-owned work identity
      (`docs/mission/intent.md`, "Execution must not depend on the tracker"). Nothing in
      this diff reads, writes or produces a tracker reference, and admitting the namespace
      into a lane-identity pattern does not make it a tracker identity.

## EVIDENCE:

### Static

| Command | Result |
|---|---|
| `pnpm exec tsx --test scripts/ops/merge-gate-verdict.test.ts` | 38 tests, 38 pass, 0 fail (34 pre-existing -- 21 original plus the 13 canonical-`Bounce:` tests that arrived from `main` in the reconciliation merge -- plus the 3-identity loop, the drift lock and the boundary test) |
| `pnpm exec tsx --test scripts/ci/file-scope-guard.test.ts` | 52 tests, 52 pass, 0 fail (46 pre-existing + the 6 WORK-identity tests) |
| `pnpm exec tsx --test scripts/ops/workflow-hardening.test.ts` | 66 tests, 66 pass, 0 fail |
| `pnpm verify:static` | exit 0 -- 6902 tests, 6902 pass, 0 fail. This is the whole of `pnpm verify` except `test:live-db`, so `lint`, `type-check`, `build` and `test` are all inside it. |
| `pnpm exec tsx scripts/ci/r-level-check.ts --issue UTV2-1892 --base origin/main --head d9d5a533bbdc61888b368677d8a8e5efd73d2a12` | PASS, 10 changed files, no R-level rule matched |

### Mutation battery (run alone, source restored and sha256-checked afterwards)

| Mutation | Suite | Failing |
|---|---|---|
| revert the `.cjs` hunk only | merge-gate-verdict.test.ts | 2: `not ok 21 - repository and legacy identity WORK-2026091001 retain exact-head PM approval checks`, `not ok 24 - UTV2-1892: merge-gate.yml issue extraction and parseVerdict admit the same namespaces` |
| revert the `.yml` hunk only | merge-gate-verdict.test.ts | 1: `not ok 24 - UTV2-1892: …admit the same namespaces` |
| drop the headRef trailing boundary | merge-gate-verdict.test.ts | 1: `not ok 25 - UTV2-1892: workflow issue extraction is bounded at both ends` |
| drop the title leading boundary | merge-gate-verdict.test.ts | 1: `not ok 25` |
| drop the grep lookbehind | merge-gate-verdict.test.ts | 1: `not ok 25` |
| widen the parser to `BOOTSTRAP` | merge-gate-verdict.test.ts | 1: `not ok 24` (the reverse-direction check) |
| narrow `ISSUE_NAMESPACES` back to `'UTV2'` (the pre-repair state) | file-scope-guard.test.ts | 2: `not ok 47 - UTV2-1892: a WORK lane is granted its own lifecycle bookkeeping paths`, `not ok 48 - UTV2-1892: laneLifecycleScopePatterns keys every admitted namespace, and only those` |
| open `ISSUE_NAMESPACES` to `'UTV2|UNI|WORK|BOOTSTRAP|FOO|BOOT'` | file-scope-guard.test.ts | 2: `not ok 48`, `not ok 52 - UTV2-1892: an unrecognised namespace branch still fails closed with no own manifest` |
| restored | file-scope-guard.test.ts | 0: 52/52 |

### Independent review

`codex exec -s read-only` at `f638dd89f`: **CHANGES_REQUIRED** on one blocking finding (no trailing
token boundary; `homework-123` resolved as `WORK-123`) and one advisory (the drift lock read only
the workflow's namespaces). Both are addressed at `63115cbff`. The reviewer confirmed the T1 trust
boundary unchanged: authorized-reviewer filtering, PR-number and head-SHA equality, CODEOWNERS,
`AUTHORIZED_REVIEWERS`, required checks, bounce handling and supersession ordering.

### The reviewer's probe, re-executed at this head

```
WORK-2026091001 -> {"verdict":"APPROVED","issueId":"WORK-2026091001","prNumber":1556,"headSha":"ecb7daeaff2fc4a346855e73bd5669e7644e3faf"}
UTV2-1889       -> {"verdict":"APPROVED","issueId":"UTV2-1889","prNumber":1556,"headSha":"ecb7daeaff2fc4a346855e73bd5669e7644e3faf"}
BOOTSTRAP-1     -> null
```

## Verification
- [x] `pnpm verify:static`: exit 0 (6902/6902) -- `lint`, `type-check`, `build` and `test` all inside it
- [ ] `pnpm verify`: NOT RUN on the workstation by design -- `verify` ends at
      `test:live-db`, where `ci:assert-staging` refuses any target that is not staging
      `xskgrzbteyqdufktjrjx`. The CI `verify` job on this PR is the authoritative run.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --issue UTV2-1892 --base origin/main --head d9d5a533bbdc61888b368677d8a8e5efd73d2a12`: PASS, no rule matched

## Runtime Verification

This lane changes no application code and no database path. Its runtime is the Merge Gate
workflow itself, which cannot be exercised on a workstation: the trusted copy runs from
`pull_request.base.sha`, so the repaired parser becomes live only after this PR merges.
The lane is admitted under the route B deferral (`t1_live_db_precondition: deferred_to_ci`),
so the live-DB obligation is discharged by the CI `verify` and `Writable DB proof (staging
only)` jobs on the merge SHA, and closeout check G6 refuses to close without both green.
The runtime proof block in `evidence.json` is filled from one concluded run and from
nothing else: run `35671709911` attempt 1 **at the anchor itself**, not at a byte-identical
neighbour. Job `106569598536` "Writable DB proof (staging only)" success (00:23:53Z-00:29:23Z)
-- `pnpm test:db` 7/7, `pnpm test:t1-proof:live` 140/140 over 24 suites, 0 fail, 0 skipped,
the target guard OK in each credentialed invocation -- and job `106570818744` `verify` success
in the same run (00:29:25Z-00:34:21Z), whose `Verify (static)` step reported 6902/6902,
identical to the figure measured locally. The same-run, attempt-scoped auditor
`scripts/ci/verify-db-proof-receipt.ts` returned `Verdict: PASS` with
`Observed project: xskgrzbteyqdufktjrjx` equal to `Expected staging`. Receipt
`ci-db-proof-receipt.json` sha256
`55e371fda801a9c48dcac6550285fd3040151f47b4c128ffc242d0623a979f5a`, artifact
`utv2-1630-db-proof-receipt-35671709911-1` (id `10671492278`).

One honest qualification, recorded rather than omitted: the `Audit production dependencies`
step's own outcome is `failure` and the step is `continue-on-error`, so that run's CI truth
summary prints `audit: failure` while the `verify` job concludes success. That is the
pre-existing `pnpm audit --prod` advisory condition affecting every PR on `main`; this lane
does not introduce it and does not change it.

The earlier run at `db3249992` (`35671433656`) was cancelled by concurrency when the
`lane-pr-binding` workflow pushed the anchor commit, and the run at `92f34932f`
(`34746934490`) that the previous edition of this bundle cited is superseded by the anchor
move. Neither is withdrawn; both are simply no longer the binding measurement.

The first live exercise of the repaired trusted parser is PR 1556's resync and final
verdict, which is the next step the reviewer directed after this lands.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1570
Execution SHA: d9d5a533bbdc61888b368677d8a8e5efd73d2a12

Execution anchor: `d9d5a533bbdc61888b368677d8a8e5efd73d2a12` -- the last commit on this lane that changes anything outside
`docs/06_status/proof/UTV2-1892/`. It is the `lane-pr-binding` workflow's own commit, which wrote
`pr_url` into `docs/06_status/lanes/UTV2-1892.json` once the PR was reopened. Every commit above it
touches only the proof directory.

Readmission history, because the anchor moved and the reason matters. PR #1570 was closed on
2026-09-14 for one reason only: to release its locks on the two parser files so the
canonical-`Bounce:` repair could take them. It was reopened on 2026-09-21 under the same
UTV2-1892 authority -- no new tracker issue was minted for it, deliberately. The lane was
readmitted with `ops:lane-start --readmit-existing-branch --singleton-approved`, which re-pinned
`file_scope_lock` to the five files this bundle measures, and the branch was reconciled onto
`origin/main` `6846fe19f` by merge commit `71c7fa65a`. That merge had exactly one conflict, in
`scripts/ops/merge-gate-verdict.test.ts`, where this lane and the canonical-`Bounce:` lane had both
appended tests to the end of the same file; both sets are kept, neither supersedes the other, and
38/38 pass after the resolution. The merge brings no source change of its own:
`git diff --name-only 6846fe19f d9d5a533bbdc61888b368677d8a8e5efd73d2a12 -- apps packages supabase` is empty.

The merge row above is bound by `post-merge-lane-close.yml` after the merge.
