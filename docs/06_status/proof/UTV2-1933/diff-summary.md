# PROOF: UTV2-1933 Diff Summary

MERGE_SHA: 8623fba498b8ce67cd2b47171d41060243b5fc1e

Generated at: 2026-09-18T14:15:00.000Z
Issue: UTV2-1933
Tier: T1
Lane type: runtime
Branch: claude/utv2-1933-stranded-outbox-control
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1607
Head SHA: d1940e0b00cf05e45dc6e92cbf9a064f9c570fb8
Execution SHA: d1940e0b00cf05e45dc6e92cbf9a064f9c570fb8
Diff base: c79a5bb2a2a9113222459983a0c55c5720a2045a
result: pass

## Git Diff Stat

```
 .../src/t1-proof-utv2-993-worker-restart.test.ts   |  78 +++++++++++--
 docs/05_operations/QUEUE_READINESS_SEMANTICS.md    |  48 +++++++-
 scripts/ops/readiness-refresh.test.ts              |  97 ++++++++++++++++
 scripts/ops/readiness-refresh.ts                   | 124 +++++++++++++++++++--
 4 files changed, 321 insertions(+), 26 deletions(-)
```

## The defect: one missing predicate, two controls broken in opposite directions

`distribution_outbox` holds rows stranded in `status = 'processing'` past the reaper window.
Two independent controls read that same population, and neither asked the one question that
decides what a row means: **could any worker ever have claimed it?**

### Control A — a blocking readiness dimension that could never pass

`scripts/ops/readiness-refresh.ts` counted every stale `processing` row and failed
`worker_outbox_health` on the total. `worker_outbox_health` is a **blocking** dimension.

Production holds **32** such rows, all four of whose targets are `utv2-1497-canary-*`. Those
targets appear in no worker configuration, so no worker polls them, no worker claims them, and
`reapStaleClaims` never sees them. They cannot drain by any runtime mechanism. The count could
therefore never reach zero, and the dimension could never pass — while a genuine stuck row on a
real target would have changed nothing an operator could see.

`plan.md` had explained this red away as containment. It is not: `ingestor_health` is genuine
containment (`AUTORUN=false`), but `worker_outbox_health` is a row-classification defect. That
correction lands in UTV2-1934.

### Control B — a T1 control that could never fail

`apps/worker/src/t1-proof-utv2-993-worker-restart.test.ts` read the **same** rows, printed them,
described them as a "historical gap (pre-reaper deployment)", and ended in `assert.ok(true, …)`.
It asserted nothing. A real regression — the reaper failing on a live target tomorrow — would
have produced a green test.

A permanently-red gate and a vacuous test are the same failure wearing opposite signs. The red
one gets rationalised as known; the green one is never looked at.

## What changed, and why

### The partition predicate

`isGovernedDeliveryTarget()` (`packages/contracts/src/promotion.ts:47`) already answers the
question, config-independently, over `governedDeliveryTargets` =
`promotionTargets ++ humanDeliveryTargets`. **Both controls now use it, and neither re-declares
the target list** — a second copy of that list is exactly how a control and the worker come to
disagree about the same row (the UTV2-1923 lesson).

### `scripts/ops/readiness-refresh.ts`

- New exported `bucketStaleProcessingRows(rows)` returns `{ claimable, unclaimable,
  unclaimableTargets }`.
- **It fails closed.** A row whose `target` is missing or is not a string counts as
  **claimable**. An unreadable target is not evidence that nothing owns the row.
- The stale-processing probe changed from `db.countRows(...)` to
  `db.selectRows('distribution_outbox', 'id, target, updated_at', …,
  STALE_PROCESSING_READ_LIMIT)` — the verdict depends on each row's target, and `DbFilter`
  cannot express "the target is one a worker governs". The comment at the call site says so.
- `STALE_PROCESSING_READ_LIMIT = 20000` is exported, and a **read-limit guard** fails the probe
  when the returned row count reaches it: a partial read must not be reported as a clean
  partition.
- The failure rule now fires on `staleBuckets.claimable > 0` only. Bucket 5b never gates.
- The evidence string names the claimable and unclaimable counts **and lists the distinct
  unclaimable targets**, and `measured` gained `stale_unknown_claimable_count`,
  `stale_unknown_unclaimable_count` and `stale_unknown_unclaimable_targets`.
- `QUEUE_SEMANTICS_VERSION` 1.1 → 1.2, because the gate's meaning changed.

### `apps/worker/src/t1-proof-utv2-993-worker-restart.test.ts`

The vacuous `LIVE-DB: distribution_outbox has no long-stranded processing rows` is replaced by
`LIVE-DB: no claimable distribution_outbox row is stranded in processing`, which partitions the
live rows the same way and asserts `claimable.length === 0`, naming `reapStaleClaims` and
printing the offending rows in the failure message. Unclaimable rows are still reported — they
are a real data-hygiene finding — but they no longer decide the verdict.

### `docs/05_operations/QUEUE_READINESS_SEMANTICS.md`

Version 1.1 → 1.2. Bucket 5 gains a **5a (claimable) / 5b (unclaimable)** subsection stating the
predicate, the fail-closed direction, why the split exists, and that **5b rows are reported,
never deleted**. The gate table row now reads: fails on any 5a row; 5b never gates.

## The 32 rows are not deleted

Deleting them would turn a blocking readiness number green by destroying the evidence that the
classification behind it was wrong. They stay counted in `stale_unknown_count`, broken out in
`stale_unknown_unclaimable_count`, and their four distinct targets are named in both the evidence
string and `stale_unknown_unclaimable_targets`. Disposing of them is separate, owner-visible work.

## ASSERTIONS:

- [x] Governed and ungoverned targets are partitioned correctly, and the distinct unclaimable
      targets are collected and sorted. Asserted by `bucketStaleProcessingRows partitions rows by
      whether a worker could claim them` (`scripts/ops/readiness-refresh.test.ts`).
- [x] **The partition fails closed on an unreadable target.** A row with a missing or non-string
      `target` is counted claimable. Asserted by `an unreadable target counts as claimable, not
      exempt`.
- [x] `worker_outbox_health` passes when every stale row is unclaimable — the production shape
      today. Asserted by `worker_outbox_health passes when every stale processing row is
      unclaimable`.
- [x] **It still fails on one genuine stale row.** Asserted by `worker_outbox_health still fails
      on a single claimable stale row`, which adds one governed-target row to the unclaimable
      set and requires the probe to fail.
- [x] The evidence names the unclaimable targets rather than burying them in a count. Asserted by
      `the evidence names the unclaimable targets`.
- [x] A partial read is not reported as a clean partition. Asserted by `a read at the limit fails
      rather than reporting a clean partition`.
- [x] The live-DB T1 control now asserts. Asserted by `LIVE-DB: no claimable distribution_outbox
      row is stranded in processing`, which requires `claimable.length === 0` — replacing an
      `assert.ok(true)` that could not fail.
- [x] Neither control re-declares the governed target list; both call
      `isGovernedDeliveryTarget()` from `@unit-talk/contracts`.
- [x] **No row is deleted, updated or written.** The diff contains no `delete`, `update` or
      `insert` against `distribution_outbox`; both probes are reads.
- [x] No containment flag, kill switch, delivery target or approval path is touched.

## EVIDENCE:

See `verification.md` and `evidence.json` in this bundle for the measured command output and the
three-mutation drill and its baseline.

## Merge SHA Binding

Merge SHA: 8623fba498b8ce67cd2b47171d41060243b5fc1e
PR: https://github.com/griff843/Unit-Talk-v2/pull/1607
Approved PR head: pending merge
Execution SHA: d1940e0b00cf05e45dc6e92cbf9a064f9c570fb8
