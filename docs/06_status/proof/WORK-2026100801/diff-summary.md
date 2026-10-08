# WORK-2026100801 Diff Summary

Execution SHA: `b8860735ac9127b1d92f202a5481debb0e14b4ff`<br>
Diff base: `20f5c6e8b084655b6172da9ac76a6d8076ace642` (`origin/main`)<br>
Merge SHA: pending merge<br>
PR: https://github.com/griff843/Unit-Talk-v2/pull/1725

## What changed

- The native `Executor Result Validation` and `Merge Gate` required-check definitions retain their
  eligible `pull_request` publications and required identities but no longer contain
  `actions: write` jobs or comment/manual write-capable entry points.
- `required-check-refresh.yml` is the only workflow with `actions: write`. Its supported triggers
  (`issue_comment`, `repository_dispatch`, and validated `workflow_run`) use default-branch YAML,
  consume GitHub metadata only, and rerun only the newest completed native run matching the exact
  workflow path, event, repository, PR, and live head.
- Merge Gate and immediate pre-merge authorization accept carry-forward only when the complete
  machine code vector is nonempty and stale-head-only, then recompute C1-C7 through the trusted
  collector. They bind the computed result to the original approval SHA/comment URL and successor
  head while leaving the original PM comment immutable.
- Regression tests cover privilege boundaries, exact-run selection, review-run PR association,
  collector failure/refusal shapes, receipt forgery, head movement, and hostile head
  materialization/execution patterns.

## Measured privilege defect

At the diff base, both native required-check YAML files contained an `actions: write` refresh job:
Executor Result Validator exposed `issue_comment` and `workflow_dispatch`; Merge Gate exposed those
events plus `pull_request_review`. At the execution SHA, neither native definition contains
`actions: write`; the single executable `actions: write` grant is in the default-controlled retry
broker.

## Git diff stat at execution SHA

```text
15 files changed at final local R-level evaluation; no R-level rules matched.
```

Proof artifacts added after the execution SHA are confined to this named proof directory and the
lane manifest/sync records.

## SHA Binding

Execution SHA: `b8860735ac9127b1d92f202a5481debb0e14b4ff`<br>
Merge SHA: pending merge<br>
PR: https://github.com/griff843/Unit-Talk-v2/pull/1725
