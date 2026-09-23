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
Head SHA: 0946acb8eeb0f4d4f8d4ab70b18cfd34b84bba61
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
| `pnpm exec tsx scripts/ci/r-level-check.ts --issue UTV2-1892 --base origin/main --head 0946acb8eeb0f4d4f8d4ab70b18cfd34b84bba61` | PASS, 10 changed files, no R-level rule matched |

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
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --issue UTV2-1892 --base origin/main --head 0946acb8eeb0f4d4f8d4ab70b18cfd34b84bba61`: PASS, no rule matched

## Runtime Verification

This lane changes no application code and no database path. Its runtime is the Merge Gate
workflow itself, which cannot be exercised on a workstation: the trusted copy runs from
`pull_request.base.sha`, so the repaired parser becomes live only after this PR merges.
The lane is admitted under the route B deferral (`t1_live_db_precondition: deferred_to_ci`),
so the live-DB obligation is discharged by the CI `verify` and `Writable DB proof (staging
only)` jobs on the merge SHA, and closeout check G6 refuses to close without both green.
The runtime proof block in `evidence.json` is filled from one concluded run and from
nothing else: run `35807801729` attempt 1 **at the anchor itself**, not at a byte-identical
neighbour. Job `107012398481` "Writable DB proof (staging only)" success (01:48:26Z-01:58:35Z)
-- `pnpm test:db` 7/7 in 51322.5ms, `pnpm test:t1-proof:live` 140/140 over 24 suites in
530324ms, 0 fail, 0 skipped, the target guard OK in each credentialed invocation -- and job
`107014509057` `verify` success in the same run (01:59:13Z-02:04:10Z), whose `Verify (static)`
step reported 6902/6902, identical to the figure measured locally, alongside Command Center
tests 659/659. The same-run, attempt-scoped auditor
`scripts/ci/verify-db-proof-receipt.ts` returned `Verdict: PASS` with
`Observed project: xskgrzbteyqdufktjrjx` equal to `Expected staging`. Receipt
`ci-db-proof-receipt.json` sha256
`4f85c592e386ca5f8c454e9f198b13d286234222add486fd7895bc11303c4d61`, artifact
`utv2-1630-db-proof-receipt-35807801729-1` (id `10728169122`).

One honest qualification, recorded rather than omitted: the `Audit production dependencies`
step's own outcome is `failure` and the step is `continue-on-error`, so that run's CI truth
summary prints `audit: failure` while the `verify` job concludes success. That is the
pre-existing `pnpm audit --prod` advisory condition affecting every PR on `main`; this lane
does not introduce it and does not change it.

Five earlier runs are superseded, none withdrawn: `35671433656` at `db3249992`, cancelled by
concurrency when the `lane-pr-binding` workflow pushed its commit; `35671709911` at
`d9d5a533b`, `35685090342` at `3379b4b66` and `35736058151` at `fc8b7d09f`, all green but no
longer the anchor after the successive branch refreshes; and `34746934490` at `92f34932f`,
cited by an earlier edition of this bundle. Each was true where it ran; none is the binding
measurement now.

The first live exercise of the repaired trusted parser is PR 1556's resync and final
verdict, which is the next step the reviewer directed after this lands.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1570
Execution SHA: 0946acb8eeb0f4d4f8d4ab70b18cfd34b84bba61

Execution anchor: `0946acb8eeb0f4d4f8d4ab70b18cfd34b84bba61` -- the last commit on this lane that changes anything outside
`docs/06_status/proof/UTV2-1892/`. It is the branch-refresh merge commit that reconciled this lane
onto `origin/main` `6685f171c`, produced by `ops:merge-wrapper pr-update-branch` rather than by hand.

This is the **fourth** such refresh on this PR, and the mechanism is structural rather than
incidental: the automated `ops(readiness): refresh ledger [skip ci]` job
(`.github/workflows/readiness-refresh.yml`, `cron: '0 */6 * * *'`, `contents: write`) advances
`main` every few hours, `[skip ci]` means nothing re-runs to announce it, and branch protection
sets `strict: true`, so an open PR goes `BEHIND` on its own and silently -- invalidating any
head-bound `pm-verdict/v1` issued before it. Observed landings on this PR: `b0731adc9` 02:59:50Z,
`96c990286` 10:50:56Z, `3af0379f6` 16:08:58Z, `6685f171c` 20:48:16Z. Before this fourth refresh the
operator disabled that workflow (`state=disabled_manually`) so the landing window is deterministic
rather than a race; it is to be re-enabled after this PR merges. Each refresh moves the anchor,
because `scripts/ci/proof-binding-validator.ts` rule 4 compares *trees*
(`git diff --name-only <anchor>..HEAD`) and the ledger file would otherwise read as non-proof
drift.

No refresh has produced a conflict and none has changed an implementation file. Each introduced
exactly `docs/06_status/readiness/readiness-score.json`, and
`git diff --stat ab4d0b0ca 0946acb8e -- scripts/ .github/ .ops/ docs/06_status/proof/ docs/06_status/lanes/`
is empty. Superseded anchors, in order and none withdrawn:
`d9d5a533bbdc61888b368677d8a8e5efd73d2a12` (the `lane-pr-binding` workflow's own commit, which
wrote `pr_url` into `docs/06_status/lanes/UTV2-1892.json` once the PR was reopened),
`3379b4b66c775612528d000b8efa6ab565d07853`, `fc8b7d09fac867fd0b1a2502b2e743ad0c69433f` and
`0946acb8eeb0f4d4f8d4ab70b18cfd34b84bba61` (the first, second and third branch refreshes).
Every commit above the anchor touches only the proof directory.

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
`git diff --name-only 6685f171c 0946acb8eeb0f4d4f8d4ab70b18cfd34b84bba61 -- apps packages supabase` is empty.

The merge row above is bound by `post-merge-lane-close.yml` after the merge.
