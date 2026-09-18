# PROOF: UTV2-1933

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries the
> verified implementation identity. `post-merge-lane-close.yml` rebinds merge authority only
> after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-18T14:45:00.000Z
Issue: UTV2-1933
Tier: T1
Lane type: runtime
Branch: claude/utv2-1933-stranded-outbox-control
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1607
Head SHA: d1940e0b00cf05e45dc6e92cbf9a064f9c570fb8
Execution SHA: d1940e0b00cf05e45dc6e92cbf9a064f9c570fb8
Diff base: c79a5bb2a2a9113222459983a0c55c5720a2045a
result: pass

> One missing predicate made a blocking readiness dimension unable to pass and a T1 control
> unable to fail. This lane supplies the predicate to both, from the single canonical source, and
> deletes nothing.

## ASSERTIONS:

Each box is an assertion a named, mutation-proven test makes. None restates intent.

### The partition is correct and comes from one source

- [x] Governed and ungoverned targets are partitioned, and the distinct unclaimable targets are
      collected and sorted. Asserted by `bucketStaleProcessingRows partitions rows by whether a
      worker could claim them` (`scripts/ops/readiness-refresh.test.ts`).
- [x] Neither control re-declares the governed target list. Both call `isGovernedDeliveryTarget()`
      from `@unit-talk/contracts` (`packages/contracts/src/promotion.ts`), which is derived from
      `governedDeliveryTargets` = `promotionTargets ++ humanDeliveryTargets`. A second copy of that
      list is how a control and the worker come to disagree about the same row.
- [x] **The partition fails closed.** A row whose `target` is missing or is not a string counts as
      **claimable**, because an unreadable target is not evidence that nothing owns the row.
      Asserted by `an unreadable target counts as claimable, not exempt`.

### The gate now means something in both directions

- [x] `worker_outbox_health` passes when every stale row is unclaimable — the production shape
      today. Asserted by `worker_outbox_health passes when every stale processing row is
      unclaimable`.
- [x] **It still fails on one genuine stale row.** Asserted by `worker_outbox_health still fails on
      a single claimable stale row`, which adds exactly one governed-target row to an otherwise
      unclaimable set and requires the probe to fail. Without this, the repair would be
      indistinguishable from switching the gate off.
- [x] A partial read is not reported as a clean partition. The probe fails when the returned row
      count reaches `STALE_PROCESSING_READ_LIMIT`. Asserted by `a read at the limit fails rather
      than reporting a clean partition`.
- [x] The evidence names the unclaimable targets rather than burying them in a count. Asserted by
      `the evidence names the unclaimable targets`. `measured` also gained
      `stale_unknown_claimable_count`, `stale_unknown_unclaimable_count` and
      `stale_unknown_unclaimable_targets`.

### The mirror control now asserts

- [x] The T1 Dimension 1 control asserts `claimable.length === 0` and names `reapStaleClaims` in
      its failure message. It replaces a test that read the same rows, called them a "historical
      gap", and ended in `assert.ok(true, …)` — a control that could not fail.
- [x] Unclaimable rows are still reported by that test. They are a real data-hygiene finding; they
      simply no longer decide the verdict.

### Nothing was deleted, activated or weakened

- [x] **No row is deleted, updated or inserted.** Both probes are reads. The diff contains no
      write against `distribution_outbox`.
- [x] No containment flag, kill switch, delivery target, approval path or deploy is touched.
- [x] `QUEUE_SEMANTICS_VERSION` moved 1.1 → 1.2 and
      `docs/05_operations/QUEUE_READINESS_SEMANTICS.md` records the 5a/5b split, the fail-closed
      direction, and that 5b rows are reported and never deleted — so the gate's meaning and its
      documentation move together rather than drifting apart.

## MUTATION CONTROLS:

A control that cannot fail proves nothing — which is the entire subject of this lane, so proving
the replacement is not vacuous matters more here than usual. Each mutation was applied against the
suite at this head and the baseline restored byte-identical afterwards.

| Mutation applied | Expected | Observed |
|---|---|---|
| Classify **every** row as unclaimable in `bucketStaleProcessingRows` | the partition and both gate-direction controls fail | **3 of 32 tests fail** |
| Treat a missing/non-string `target` as unclaimable (fail **open**) | the fail-closed control fails | `an unreadable target counts as claimable, not exempt` fails |
| Remove the `STALE_PROCESSING_READ_LIMIT` guard | the partial-read control fails | `a read at the limit fails rather than reporting a clean partition` fails |
| None (baseline) | all pass | **32 pass / 0 fail / 0 skipped** |

The first mutation is the important one. It is the "make the problem disappear" mutation — the
shape a lazy repair would take, exempting everything so the number goes green. Three tests catch
it, so this repair is provably not that repair.

## RUNTIME EVIDENCE:

Measured read-only against production `zfzdnfwdarxucxtaojxm` on 2026-09-18. Nothing was written,
updated or deleted; no containment setting, kill switch or delivery target was touched.

### The population the gate was failing on

```sql
select target, count(*) as rows, min(updated_at), max(updated_at)
from distribution_outbox
where status = 'processing' and updated_at < now() - interval '5 minutes'
group by target order by target;
```

| target | rows | written |
|---|---|---|
| synthetic canary target 1 | 8 | 2026-07-30 17:55:09 |
| synthetic canary target 2 | 8 | 2026-07-30 19:10:30 |
| synthetic canary target 3 | 8 | 2026-07-30 19:31:30 |
| synthetic canary target 4 | 8 | 2026-07-30 20:04:42 |
| **total** | **32** | all on 2026-07-30 |

**Zero** of the 32 sit on a governed delivery target. Under `isGovernedDeliveryTarget()` all 32
partition to bucket 5b and none to 5a, so the repaired gate passes on today's production shape —
and would still fail on a single genuine stuck row, which is the property the mutation drill
proves.

| Probe | Value |
|---|---|
| stale `processing` rows, total | **32** |
| of those, claimable (bucket 5a) | **0** |
| of those, unclaimable (bucket 5b) | **32** |
| distinct unclaimable targets | **4** |
| rows written, updated or deleted by this proof | **0** |

### The 32 rows are not removed

Deleting them would turn a blocking readiness number green by destroying the evidence that the
classification behind it was wrong. They remain, counted in `stale_unknown_count`, broken out in
`stale_unknown_unclaimable_count`, and named in both the evidence string and
`stale_unknown_unclaimable_targets`. Disposing of them is separate, owner-visible work.

## Verification

EVIDENCE:

| Command | Exit | Result |
|---|---|---|
| `pnpm lint` | 0 | pass — `eslint . --cache`, no output |
| `pnpm type-check` | 0 | pass — `pnpm exec tsc -b tsconfig.json`, no diagnostics |
| `pnpm test` | 0 | pass — **5,934 `ok` lines, 0 `not ok`**, 104 suite blocks each `# fail 0` |
| `pnpm exec tsx --test scripts/ops/readiness-refresh.test.ts` | 0 | 32 pass / 0 fail / 0 skipped (5 new tests) |
| `pnpm exec tsx --test apps/worker/src/t1-proof-utv2-993-worker-restart.test.ts` | 1 | 2 pass / 3 fail — all three are `TypeError: fetch failed`; see below |
| `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | 0 | `Verdict: PASS`, 10 changed files, rules matched `lifecycle-fsm` |
| `pnpm verify` | 1 | `verify:static` and `verify:commands` pass; `ci:assert-staging` refuses a non-staging target, by design |
| `pnpm test:db` | — | not run locally; it is gated behind the same `ci:assert-staging` refusal. Executed in CI by the `Writable DB proof (staging only)` job on PR #1607, **conclusion: success**, which is also what produces the `ci-db-proof-receipt/v2` the required `verify` context validates. |

```
$ pnpm exec tsx --test scripts/ops/readiness-refresh.test.ts
# tests 32
# pass 32
# fail 0
# skipped 0
```

```
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 10
Rules matched: lifecycle-fsm

Advisory (PM-gated) artifacts missing:
  - r4-fault-report [PM-gated]
```

### Why three LIVE-DB tests fail locally, and why that is environmental

```
error: 'distribution_outbox query failed: TypeError: fetch failed'
error: 'distribution_receipts query failed: TypeError: fetch failed'
error: 'system_runs open-circuit query failed: TypeError: fetch failed'
```

All three fail identically, at the network layer, against the containment placeholder
`SUPABASE_URL`. **Two of the three are pre-existing LIVE-DB tests this lane never touched** — that
is what identifies the cause as the environment rather than as a defect in the change. These files
are not part of `pnpm test`; they run under `test:t1-proof:live` inside the `staging-ci`
environment, which is the authority for them.

`pnpm verify` cannot exit 0 from a developer checkout on this repository: `ci:assert-staging`
refuses any target that is not the staging project (`host=127.0.0.1 ref=unidentified
expected=xskgrzbteyqdufktjrjx`). That is deliberate staging-isolation containment and the correct
local outcome. The authoritative full-tree result is the required `verify` context on PR #1607.

## STOP CONDITIONS ENCOUNTERED:

- **This is a T1 lane.** Merge authority requires the `t1-approved` label **and** a
  `pm-verdict/v1` APPROVED comment from CODEOWNERS. Nothing here self-certifies that.
- **The 32 unclaimable rows are not disposed of by this lane**, deliberately. Removing production
  rows is reserved, and removing these particular rows would destroy the evidence for the
  classification repair itself.
- **No containment change is made or requested**, and the provider remains owner-deferred — this
  lane is entirely provider-independent.

## Sign-off

Verifier Identity: Claude Opus 5 (1M context), acting as execution orchestrator
Date: 2026-09-18
Commit SHA(s): d1940e0b00cf05e45dc6e92cbf9a064f9c570fb8
Related PRs: https://github.com/griff843/Unit-Talk-v2/pull/1607

Merge authority for this T1 lane is the `t1-approved` label plus a `pm-verdict/v1` APPROVED
comment. Nothing in this bundle self-certifies Done; the done-gate is `ops:truth-check`.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1607
Approved PR head: pending merge
Execution SHA: d1940e0b00cf05e45dc6e92cbf9a064f9c570fb8
