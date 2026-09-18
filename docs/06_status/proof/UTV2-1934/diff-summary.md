# PROOF: UTV2-1934 Diff Summary

MERGE_SHA: 902e8ba0ae4bb832b2e1679519da6b8923262bb8

Generated at: 2026-09-18T14:25:00.000Z
Issue: UTV2-1934
Tier: T3
Lane type: governance
Branch: claude/utv2-1934-startup-context-containment-truth
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1605
Head SHA: bfed688855be2e0fc5d84076811cdc03cd6e6ff8
Execution SHA: bfed688855be2e0fc5d84076811cdc03cd6e6ff8
Diff base: 3a07f41b0a09fddb924e964e255e16b6c8e0a80b
result: pass

## Git Diff Stat

```
 .ops/sync/UTV2-1934.yml                            | 112 +++++++++++++++
 .../READINESS_MEASUREMENT_2026-09-14.md            |  29 ++--
 docs/06_status/lanes/UTV2-1934.json                |  38 +++++
 docs/06_status/proof/UTV2-1934/.gitkeep            |   0
 docs/mission/plan.md                               | 158 ++++++++++++++++-----
 5 files changed, 292 insertions(+), 45 deletions(-)
```

This is a documentation-only lane. No source file, workflow, schema, script or test is changed;
`git diff --name-only` outside `docs/` and `.ops/` is empty.

## Why this lane exists

`docs/mission/plan.md` is injected as startup context on every session. When it is wrong, every
session that reads it starts from a false premise — and its own §9 already records that a drift
conclusion is a reading taken at an instant, not a durable fact. §1 and §2 had gone measurably
false in six places at once.

## What was re-measured, and what each correction is

Every value below was measured against the GitHub API, the lane manifests on `main`, or
production `zfzdnfwdarxucxtaojxm` on 2026-09-18 — not edited forward from the previous text.

| § | Was | Is | How measured |
|---|---|---|---|
| 1 | `main` = `17b3f964f` | `3a07f41b0` | `git rev-parse origin/main` |
| 1, 2 | drift 6 commits / 32 files | **11 commits / 36 files** | `git diff --name-only 961f17c64..origin/main` |
| 1 | Open PRs: 11 | **10** | GitHub API |
| 1 | Active lanes: three parked plus two live | **zero on `main`** — every tracked manifest terminal; the three named "parked" have no manifest at all | read every `docs/06_status/lanes/*.json` on `main` |
| 2 | two blocking dimensions are containment | **one is** | see below |
| 6 | the `migration` lane type is blocked | **no longer blocked** — the blocking PR is closed, the singleton is free | GitHub API |

### The substantive correction: `worker_outbox_health` is not containment

The previous edition explained two blocking readiness dimensions away with one sentence.
Re-measured, they are different failures:

- `ingestor_health` **is** genuine containment. The deployed mode sets its autorun false.
- `worker_outbox_health` is **not**. The worker runs, and the readiness ledger records its
  heartbeat as succeeded in the same payload as the failure. The dimension fails solely on 32
  `distribution_outbox` rows stranded in `processing` on four synthetic canary targets that no
  worker configuration polls — so nothing can claim or reap them and the count can never reach
  zero.

The same population is read by a T1 Dimension 1 control that ends in `assert.ok(true)`. One
control can never fail and the other can never pass, from one missing distinction. That is
recorded as the lead §9 lesson, with the repair's owning lane named and an explicit refusal to
delete the rows — deleting them would turn a blocking number green by destroying the evidence
that the classification behind it was wrong.

### The owner's sequencing directive is now recorded, not carried in chat

§6 gains the standing directive that the provider is intentionally off and **deferred, not
blocked**, together with which readiness dimensions are provider-dependent (2, 3, 6 and one of
Dimension 4's two metrics) and which are provider-independent (1, 5, and Dimension 4's second
metric). §5 decision 2 is marked **owner-deferred** rather than left standing as a live ask.

A directive that lives only in a session transcript is lost at the next `/clear`. This is the
file that survives it.

### `READINESS_MEASUREMENT_2026-09-14.md` Dimension 5

The measurement failed Dimension 5 on the grounds that "none is deployed … an operator cannot
reach any of the five surfaces". That is stale: the Command Center is enabled and deployed, and
operator writes on 2026-09-18 are attributed to a Command Center operator identity.

**The dimension still FAILs** — on substantive surface gaps rather than on absence — and the
edit says so explicitly, names the lane that owns closing those gaps, and records that the
dimension is fully provider-independent. A stale *reason* attached to a correct verdict is worse
than no reason, because the next reader retires the finding when the reason is disproved.

## ASSERTIONS:

- [x] Every figure in §1 was re-measured at this head rather than carried forward. The six that
      had drifted are listed in the table above with the command or API that measured each.
- [x] `worker_outbox_health` is distinguished from `ingestor_health`: one is containment, one is
      a row-classification defect. The previous single explanation covered both and was wrong for
      one of them.
- [x] The drift figure is written with an explicit instruction to re-run the command rather than
      quote the number, because it moves every time a lane closes.
- [x] The 32 stranded rows are recorded as **not to be deleted**.
- [x] The owner's provider-sequencing directive is recorded in the file that survives a `/clear`,
      including which readiness dimensions are provider-dependent and which are not.
- [x] Dimension 5's stale failure *reason* is corrected while its **FAIL verdict is preserved**.
      The correction does not retire the finding.
- [x] **No threshold is introduced or altered.** `T1_PRODUCTION_READINESS_CONTRACT.md` remains
      the sole definition of production readiness; this diff adds no scoring, no gate and no
      exit criterion.
- [x] **No containment change is made or requested.** The diff changes no runtime setting, no
      workflow, no kill switch and no delivery target; it is documentation only.
- [x] No Griff-owned file is edited. `docs/mission/intent.md` is untouched.

## EVIDENCE:

See `verification.md` in this bundle for the measured command output.

## Merge SHA Binding

Merge SHA: 902e8ba0ae4bb832b2e1679519da6b8923262bb8
PR: https://github.com/griff843/Unit-Talk-v2/pull/1605
Approved PR head: pending merge
Execution SHA: bfed688855be2e0fc5d84076811cdc03cd6e6ff8
