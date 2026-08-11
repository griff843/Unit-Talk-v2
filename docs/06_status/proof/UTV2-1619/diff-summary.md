# UTV2-1619 diff summary — reconcile candidate filter and scheduled write path

MERGE_SHA: pending

Two defects, one in the reconciler's logic and one in its transport. Either alone
made the scheduled reconciler useless; together they were self-concealing, because
the broken transport was the only thing preventing the broken logic from corrupting
lane state on a live run.

## `scripts/ops/reconcile.ts`

Candidate selection was an inline two-value denylist:

```js
m.status !== 'done' && m.status !== 'merged'
```

That is not the inverse of "active". Every other terminal status — `failed`,
`superseded`, `cancelled`, and the 28 legacy `closed` manifests that predate the
status enum — fell through it and was swept as an active lane.

Replaced with an exported `selectReconcilableManifests()` that reads the canonical
`ACTIVE_LOCK_STATUSES` allowlist already exported by `scripts/ops/shared.ts`. An
unrecognised status now fails **closed**: not active, therefore never a candidate,
therefore never mutated. A denylist fails open on exactly the values nobody thought
to enumerate, which is how this survived.

The function selects candidates only. Whether a candidate is `stale`, `stranded`,
`orphaned` or `ghost_merged` remains entirely with `reconcileManifest`; no lifecycle
policy moved, and no status was added, removed, or redefined.

## `scripts/ops/reconcile.test.ts`

Seven regression tests covering every case in the authorization: merged stays
merged, done stays done, an active lane is untouched, legacy `closed` never becomes
`blocked`, and the dry-run set matches expectation. One test asserts the consequence
directly rather than only the guard — it calls `reconcileManifest` on a `closed`
manifest and asserts it *would* write `blocked`, so the test fails loudly if a future
change makes the filter permissive again. File total: 22 tests.

## `.github/workflows/reconcile-stale-lanes.yml`, `.github/workflows/ops-reconcile.yml`

Both checked out with the default `GITHUB_TOKEN`, which cannot push to protected
`main`. Every scheduled run computed its manifest fixes correctly, committed them,
then died on `GH006: Protected branch update failed`. `ops-reconcile.yml` passed no
`token:` at all. Both now use `${{ secrets.SYNC_BOT_TOKEN || secrets.GITHUB_TOKEN }}`
— the same credential `post-merge-lane-close.yml` already uses — falling back to
`GITHUB_TOKEN` so a missing secret fails loudly rather than silently skipping the write.

## Measured effect

Same 674-manifest corpus, same command, dry-run, measured 2026-08-11:

| | candidates | planned mutations |
|---|---|---|
| `main` (unfixed) | 31 | 16 |
| this branch | 3 | 2 |

The 2 remaining mutations are `UTV2-1627` and `UTV2-1684`, both `ghost_merged` —
exactly the targeted set this lane is authorized to reconcile. The 14 dropped
mutations were all long-terminal manifests that would have been rewritten to
`blocked`, a member of both `TOTAL_CAPACITY_STATUSES` and `TYPE_CAPACITY_STATUSES`,
manufacturing live capacity consumers out of dead history and pushing the board past
its cap of 10 with no new lane admitted.

## Scope

Four files, all inside `file_scope_lock`. No product, runtime, migration, delivery,
or domain path is touched. No governance cap, parked semantic, or lifecycle state is
changed. No lane is admitted.
