# PROOF: UTV2-1892

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-13T08:05:20.000Z
Issue: UTV2-1892
Tier: T1
Lane type: runtime
Branch: claude/utv2-1892-merge-gate-work-identity
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1570
Head SHA: 63115cbff33f0196bbe8d9aa182345be33effb0b
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
      `git diff origin/main..HEAD --stat` is three source files plus the lane manifest and
      sync file.

## EVIDENCE:

### Static

| Command | Result |
|---|---|
| `pnpm exec tsx --test scripts/ops/merge-gate-verdict.test.ts` | 25 tests, 25 pass, 0 fail (21 pre-existing + the 3-identity loop, the drift lock and the boundary test) |
| `pnpm exec tsx --test scripts/ops/workflow-hardening.test.ts` | 66 tests, 66 pass, 0 fail |
| `pnpm exec eslint scripts/ops/merge-gate-verdict.cjs scripts/ops/merge-gate-verdict.test.ts` | exit 0 |
| `pnpm type-check` | exit 0 |
| `pnpm test` | exit 0 |
| `pnpm exec tsx scripts/ci/r-level-check.ts --issue UTV2-1892 --base origin/main --head 63115cbff33f0196bbe8d9aa182345be33effb0b` | PASS, 8 changed files, no R-level rule matched |

### Mutation battery (run alone, source restored and sha256-checked afterwards)

| Mutation | Suite | Failing |
|---|---|---|
| revert the `.cjs` hunk only | merge-gate-verdict.test.ts | 2: `not ok 21 - repository and legacy identity WORK-2026091001 retain exact-head PM approval checks`, `not ok 24 - UTV2-1892: merge-gate.yml issue extraction and parseVerdict admit the same namespaces` |
| revert the `.yml` hunk only | merge-gate-verdict.test.ts | 1: `not ok 24 - UTV2-1892: …admit the same namespaces` |
| drop the headRef trailing boundary | merge-gate-verdict.test.ts | 1: `not ok 25 - UTV2-1892: workflow issue extraction is bounded at both ends` |
| drop the title leading boundary | merge-gate-verdict.test.ts | 1: `not ok 25` |
| drop the grep lookbehind | merge-gate-verdict.test.ts | 1: `not ok 25` |
| widen the parser to `BOOTSTRAP` | merge-gate-verdict.test.ts | 1: `not ok 24` (the reverse-direction check) |

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
- [x] `pnpm type-check`: exit 0
- [x] `pnpm test`: exit 0
- [ ] `pnpm verify`: NOT RUN on the workstation by design -- `verify` ends at
      `test:live-db`, where `ci:assert-staging` refuses any target that is not staging
      `xskgrzbteyqdufktjrjx`. The CI `verify` job on this PR is the authoritative run.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --issue UTV2-1892 --base origin/main --head 63115cbff33f0196bbe8d9aa182345be33effb0b`: PASS, no rule matched

## Runtime Verification

This lane changes no application code and no database path. Its runtime is the Merge Gate
workflow itself, which cannot be exercised on a workstation: the trusted copy runs from
`pull_request.base.sha`, so the repaired parser becomes live only after this PR merges.
The lane is admitted under the route B deferral (`t1_live_db_precondition: deferred_to_ci`),
so the live-DB obligation is discharged by the CI `verify` and `Writable DB proof (staging
only)` jobs on the merge SHA, and closeout check G6 refuses to close without both green.
The runtime proof block in `evidence.json` is filled from one concluded run and from
nothing else: run `34746934490` attempt 1 at head `92f34932f` (source byte-identical to the
anchor), job `103696463715` "Writable DB proof (staging only)" success -- `pnpm test:db`
7/7, `pnpm test:t1-proof:live` 125/125 over 20 suites, 0 fail, 0 skipped, target guard OK
in all three credentialed invocations -- and job `103697711293` `verify` success in the
same run. Receipt `ci-db-proof-receipt.json` sha256
`481be6689d1c3b80ca183de71e0ebea8020e67e600a660cf814f804cb322e3d4`.

The first live exercise of the repaired trusted parser is PR 1556's resync and final
verdict, which is the next step the reviewer directed after this lands.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1570
Execution SHA: 63115cbff33f0196bbe8d9aa182345be33effb0b

Execution anchor: `63115cbff33f0196bbe8d9aa182345be33effb0b` -- the last commit on this lane
that changes anything outside `docs/06_status/proof/UTV2-1892/`. The source-changing commits
are `f638dd89f` (the namespace widening) and `63115cbff` (the token boundaries and their tests);
`1a64d5f22` between them is the lane-pr-binding commit and touches only the lane manifest.
Every commit above the anchor touches only the proof directory.
The merge row above is bound by `post-merge-lane-close.yml` after the merge.
