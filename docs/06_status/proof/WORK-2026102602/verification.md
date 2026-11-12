# PROOF: WORK-2026102602

MERGE_SHA: 1d5c8b1e8057e0f183c98efdbffdc9d13879c016

Issue: WORK-2026102602
Tier: T2
result: pass

## ASSERTIONS:

- [x] `.ops/work/WORK-2026102501.md` and `.ops/work/WORK-2026102506.md` are added exactly as the lanes use them, each with one appended Executor note.
- [x] The diff touches only the three `.ops/work` files and this proof directory.
- [x] Two staging-only indexes were created on `xskgrzbteyqdufktjrjx` under PM authorization; the record below is complete and the rollback is stated.

## EVIDENCE:

Preflight for this lane ran `pnpm verify:quick`, `pnpm type-check` and `pnpm test` (checks PX1, PB1, PB2: all PASS) on the contract commit. Required CI (`verify` and the rest) is the gate for the merge head.

### Staging-only DDL record (project `unit-talk-staging-ci`, ref `xskgrzbteyqdufktjrjx`)

Authorized by the PM on 2026-10-26 for staging only. Before: 0 active sessions, no heavy locks on `picks`, no write in the preceding 90 minutes, no `ci.yml` run in progress; both index names absent. Each statement was applied on its own with `set lock_timeout = '5s'` in the same call. The executor runs statements outside a transaction block; the approved plain `CREATE INDEX` form was used.

```sql
CREATE INDEX IF NOT EXISTS picks_track_only_validated_created_idx ON public.picks (created_at, id) WHERE status = 'validated' AND (metadata->>'distributionMode') = 'track-only';
CREATE INDEX IF NOT EXISTS picks_open_states_created_idx ON public.picks (created_at, id) WHERE status IN ('validated','queued','posted');
```

Resulting definitions (both valid and ready): `picks_track_only_validated_created_idx` 872 kB; `picks_open_states_created_idx` 3088 kB.

EXPLAIN (ANALYZE, BUFFERS), `picks` at about 174k rows:

| Query | Before | After |
|---|---|---|
| Track Only validated, `order by created_at, id limit 1000` | 509 ms; index scan on `picks_status_idx`, 35,979 rows filtered, 24 MB on-disk sort; 12,253 buffers | 26 ms; ordered index scan on the new index, no sort, no filter; 861 buffers |
| Open states, `order by created_at, id limit 300` | 102 ms; parallel bitmap heap scan plus top-N sort; 12,558 buffers | 6 ms; ordered index scan on the new index; 217 buffers |

Schema drift: staging now has two indexes that no repo migration creates. This is staging-only environment tuning. Production was not changed and is not proposed to change; the first index reads `metadata` in its predicate, which makes metadata-only updates non-HOT, and that cost is unmeasured, so it must not go to production without a measurement.

Rollback, instant, touches no data:

```sql
DROP INDEX IF EXISTS public.picks_track_only_validated_created_idx;
DROP INDEX IF EXISTS public.picks_open_states_created_idx;
```

## Verification

Commands executed locally by preflight: `pnpm verify:quick`, `pnpm type-check`, `pnpm test`. `pnpm verify` is run by CI at the PR head (`verify` job), as is `scripts/ci/r-level-check.ts`. This change is documentation only, so no behavior changed.

## Merge SHA Binding

Merge SHA: 1d5c8b1e8057e0f183c98efdbffdc9d13879c016
PR: pending
Execution SHA: 5756fd9543fb4fee9d39f26525982293fb68455d
