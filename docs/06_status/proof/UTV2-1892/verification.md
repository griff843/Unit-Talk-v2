# PROOF: UTV2-1892

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-13T07:47:48.000Z
Issue: UTV2-1892
Tier: T1
Lane type: runtime
Branch: claude/utv2-1892-merge-gate-work-identity
PR URL: pending
Head SHA: f638dd89f2b9e449062461712f5da5a4e0a40c0a
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
- [x] CODEOWNERS, branch protection, the required-check set, the T1 rule (`t1-approved` label
      **and** exact-head `pm-verdict/v1`), bounce limits and supersession order are unchanged.
      `git diff origin/main..HEAD --stat` is three source files plus the lane manifest and
      sync file.

## EVIDENCE:

### Static

| Command | Result |
|---|---|
| `pnpm exec tsx --test scripts/ops/merge-gate-verdict.test.ts` | 24 tests, 24 pass, 0 fail (21 pre-existing + the 3-identity loop and the drift lock) |
| `pnpm exec tsx --test scripts/ops/workflow-hardening.test.ts` | 66 tests, 66 pass, 0 fail |
| `pnpm exec eslint scripts/ops/merge-gate-verdict.cjs scripts/ops/merge-gate-verdict.test.ts` | exit 0 |
| `pnpm type-check` | exit 0 |
| `pnpm test` | exit 0 |
| `pnpm exec tsx scripts/ci/r-level-check.ts --issue UTV2-1892 --base origin/main --head f638dd89f2b9e449062461712f5da5a4e0a40c0a` | PASS, 5 changed files, no R-level rule matched |

### Mutation battery (run alone, source restored and sha256-checked afterwards)

| Mutation | Suite | Failing |
|---|---|---|
| revert the `.cjs` hunk only | merge-gate-verdict.test.ts | 2: `not ok 21 - repository and legacy identity WORK-2026091001 retain exact-head PM approval checks`, `not ok 24 - UTV2-1892: merge-gate.yml issue extraction and parseVerdict admit the same namespaces` |
| revert the `.yml` hunk only | merge-gate-verdict.test.ts | 1: `not ok 24 - UTV2-1892: …admit the same namespaces` |

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
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --issue UTV2-1892 --base origin/main --head f638dd89f2b9e449062461712f5da5a4e0a40c0a`: PASS, no rule matched

## Runtime Verification

This lane changes no application code and no database path. Its runtime is the Merge Gate
workflow itself, which cannot be exercised on a workstation: the trusted copy runs from
`pull_request.base.sha`, so the repaired parser becomes live only after this PR merges.
The lane is admitted under the route B deferral (`t1_live_db_precondition: deferred_to_ci`),
so the live-DB obligation is discharged by the CI `verify` and `Writable DB proof (staging
only)` jobs on the merge SHA, and closeout check G6 refuses to close without both green.
The runtime proof block in `evidence.json` is filled from those concluded runs and from
nothing else.

The first live exercise of the repaired trusted parser is PR 1556's resync and final
verdict, which is the next step the reviewer directed after this lands.

## Merge SHA Binding

Execution anchor: `f638dd89f2b9e449062461712f5da5a4e0a40c0a` -- the only commit on this lane
that changes anything outside `docs/06_status/proof/UTV2-1892/` after the lane-start
metadata commit `fc9be983c`. Every commit above it touches only the proof directory.
Merge SHA: bound by `post-merge-lane-close.yml` after the merge.
