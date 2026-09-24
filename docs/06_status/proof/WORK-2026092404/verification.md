# PROOF: WORK-2026092404

MERGE_SHA: pending merge

> Pre-merge, the merge row is intentionally a placeholder. The Execution SHA row carries the
> verified implementation identity. `post-merge-lane-close.yml` rebinds merge authority only
> after GitHub supplies the merged-PR attestation.

Issue: WORK-2026092404
Tier: T1
Lane type: runtime
Branch: claude/work-2026092404-cc-health-runtime
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1647
Execution SHA: 71a80b503950cbe44356124470b5895ba583fe77
Head SHA: 71a80b503950cbe44356124470b5895ba583fe77
result: pass

## ASSERTIONS:

- [x] Zombie-pick detection reads the whole candidate population. The new repository read is
      filtered server-side, ordered `created_at, id`, and paged past the PostgREST 1,000-row cap.
- [x] A repository that lacks the new read is paged too, so a fake cannot reintroduce truncation.
- [x] A stranded CI proof fixture is reported in `fixtureCount` and a warning, and is not
      counted as a zombie. A real zombie beside it still makes `/health` `down` (503).
- [x] Schema-drift probes run concurrently (at most 8 in flight, canonical order kept). A
      successful result is reused for 60s per runtime; a failed check is never cached.
- [x] Outbox lookups for candidates run with bounded concurrency (8).
- [x] Each repair is mutation-proven: each of 4 mutations, applied alone, turns named tests red.
- [x] Production, read-only: 37 candidates, 0 real zombies, 8 stranded fixtures. The read takes
      24.6 ms and fits on one page.
- [x] No containment surface is touched. There are zero migrations and zero production writes.

## EVIDENCE:

Measured on `71a80b503950cbe44356124470b5895ba583fe77` in the lane worktree.

```
$ pnpm exec tsx --test apps/api/src/server.test.ts
# tests 60
# pass 60
# fail 0

$ pnpm exec tsx --test apps/api/src/model-health-scanner.test.ts
# pass 12
# fail 0

$ pnpm exec tsx --test apps/api/src/fault-injection.test.ts
# pass 74
# fail 0

$ pnpm test
tests 6850, pass 6850, fail 0 (zero 'not ok' TAP lines across the workspace)
exit 0

$ pnpm type-check
exit 0

$ pnpm lint
exit 0

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Rules matched: (none)
```

`apps/api/src/server.http.test.ts` has one failure, `POST /api/submissions with valid body
returns 201 and pick id` (400, "Request body must be valid JSON."). It fails identically on
`main` `c5ff4854f`, is not part of `pnpm test`, and exercises no file this lane changes.

### The mutation battery

Each mutation was applied alone, `server.test.ts` run, and the file restored from a
pre-mutation copy (`cmp`-checked).

```
== M1 health fallback reads one page only
not ok 57 - zombie detection reads past the first 1,000 candidates when the repository only pages
# pass 59
# fail 1
== M2 readAllOrderedPages returns after first page
not ok 58 - readAllOrderedPages returns every row across capped pages and stops on a short page
not ok 59 - readAllOrderedPages refuses a page size above the server cap, and surfaces a page error
# pass 58
# fail 2
== M3 schema-drift probes serial
not ok 60 - checkSchemaDrift probes canonical tables concurrently and keeps their order
# pass 59
# fail 1
== M4 fixture exclusion removed
not ok 54 - a stranded proof fixture is reported in fixtureCount, not counted as a zombie
not ok 55 - a real zombie still fails /health when a stranded fixture sits beside it
not ok 56 - mutation control: removing ZOMBIE_HEALTH_FIXTURE_EXCLUSION_GUARD makes a proof fixture fail /health
# pass 57
# fail 3
== restored
# pass 60
# fail 0
```

## Verification
- [x] `pnpm type-check`: exit 0
- [x] `pnpm test`: exit 0, with 6850 tests, 6850 pass and 0 fail
- [x] `pnpm lint`: exit 0
- [ ] `pnpm verify`: not runnable locally (staging-target assertion). It is executed by the required `verify` check on this PR.
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: Verdict PASS

## Runtime Verification

### Production, read-only (Supabase `zfzdnfwdarxucxtaojxm`, 2026-09-24T16:31Z)

No write was made. The statement the new repository method issues through PostgREST,
`EXPLAIN ANALYZE`d as SQL:

```
select id,status,promotion_status,promotion_target,metadata,selection,created_at from public.picks
where status in ('draft','validated') and promotion_status in ('qualified','promoted')
  and promotion_target is not null
order by created_at asc, id asc limit 1000 offset 0;

Index Scan using picks_promotion_target_idx on picks (actual rows=37)
Execution Time: 24.628 ms
```

The previous read, `status in ('draft','validated')` alone, matches **38,939** rows, and
PostgREST returns 1,000 of them.

The same classification `checkZombiePickHealth` applies, computed over those 37 rows:

| candidates | Track Only | with an active outbox row | stranded, fixture | stranded, real (zombies) |
|---:|---:|---:|---:|---:|
| 37 | 6 | 23 | 8 | **0** |

The 8 fixtures are `8ff6dd60`, `e33f5253`, `4725244b`, `e99501e5`, `3da6e348`,
`e250b64f` (selection `UTV2 Proof Player … Over 27.5`) and `05deb7b1`, `517b90d4`
(`metadata.proof_issue = UTV2-1022`). All were created between 2026-05-29 and 2026-06-29.

### Live-DB half, deferred to CI

This lane carries `t1_live_db_precondition: deferred_to_ci`. The staging half is supplied by
the `Writable DB proof (staging only)` job on the merge SHA, against staging
`xskgrzbteyqdufktjrjx`. It is **not** fabricated here: `runtime_proof.status` in
`evidence.json` reads `PENDING_CI`, and is populated at closeout. That job runs the existing
`pnpm test:db` suite. It does not call `listPromotedByLifecycleStates`: the lane's file scope
admits no live-DB test file. The production measurement above is the runtime evidence for the new
read.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1647

### Re-anchor to `71a80b503950cbe44356124470b5895ba583fe77`

Branch refreshed from origin/main `2f5c14811` after main advanced. The merge brings in only main's own
changes: `.ops/sync/WORK-2026092311.yml`, `.ops/sync/WORK-2026092312.yml`, `.ops/sync/WORK-2026092313.yml`, `.ops/sync/WORK-2026092314.yml`, `.ops/sync/WORK-2026092405.yml`, `.ops/sync/WORK-2026092406.yml`, `docs/02_architecture/HISTORICAL_MARKET_DATA_WAREHOUSE.md`, `docs/05_operations/SGO_REACTIVATION_GATE.md`, `docs/05_operations/WAREHOUSE_HISTORICAL_BACKFILL_PLAN.md`, `docs/05_operations/WAREHOUSE_OBJECT_STORAGE_PROVISIONING.md`, `docs/06_status/lanes/WORK-2026092311.json`, `docs/06_status/lanes/WORK-2026092312.json`, `docs/06_status/lanes/WORK-2026092313.json`, `docs/06_status/lanes/WORK-2026092314.json`, `docs/06_status/lanes/WORK-2026092405.json`, `docs/06_status/lanes/WORK-2026092406.json`, `docs/06_status/proof/WORK-2026092311/diff-summary.md`, `docs/06_status/proof/WORK-2026092311/verification.md`, `docs/06_status/proof/WORK-2026092312/.gitkeep`, `docs/06_status/proof/WORK-2026092312/diff-summary.md`, `docs/06_status/proof/WORK-2026092312/verification.md`, `docs/06_status/proof/WORK-2026092313/diff-summary.md`, `docs/06_status/proof/WORK-2026092313/verification.md`, `docs/06_status/proof/WORK-2026092314/diff-summary.md`, `docs/06_status/proof/WORK-2026092314/verification.md`, `docs/06_status/proof/WORK-2026092405/diff-summary.md`, `docs/06_status/proof/WORK-2026092405/verification.md`, `docs/06_status/proof/WORK-2026092405/work-order.md`, `docs/06_status/proof/WORK-2026092406/diff-summary.md`, `docs/06_status/proof/WORK-2026092406/verification.md`, `docs/06_status/proof/WORK-2026092406/work-order.md`, `docs/06_status/readiness/readiness-score.json`, `docs/mission/plan.md`, `scripts/ops/db-health-checks.ts`, `scripts/ops/db-health-tripwire.ts`, `scripts/ops/readiness-refresh.test.ts`, `scripts/ops/readiness-refresh.ts`, `scripts/ops/workflow-hardening.test.ts`, `scripts/warehouse/conveyor.test.ts`, `scripts/warehouse/query.test.ts`. Lane-scope files changed by the merge: 0. Superseded anchor, not
withdrawn: `76a63ffc350888129fe7f9e95e8b9326cce4c4f8`. `verify` re-runs on the new head.
