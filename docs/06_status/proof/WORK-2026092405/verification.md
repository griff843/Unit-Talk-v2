# PROOF: WORK-2026092405

MERGE_SHA: 79a148dfa62d8c0b7d2313a4c039dfee39203c0a

Generated at: 2026-09-24T14:38:26.000Z
Issue: WORK-2026092405
Tier: T2
Lane type: governance
Branch: claude/work-2026092405-warehouse-backfill-credentials
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1646
Head SHA: 7cf645ebd23d11cfdd111933f393e68ca28e2bfe
Execution SHA: 7cf645ebd23d11cfdd111933f393e68ca28e2bfe
Diff base: decd67afaf99eeb41320c40eca14a9d9e9cf92a6
result: pass

## Verification

Documentation-only lane. Nothing executable changed, so the proof has two parts: every factual
claim in the documents was measured live, and the repository's own checks pass on the branch.

## ASSERTIONS:

- [x] The backfill plan's per-day quarantine counts are exact and sum to the table's 8,191,206 rows.
- [x] The history per-day figures are labelled planner estimates, and the plan requires exact
      counts at export time.
- [x] Both source tables have RLS enabled, not forced, with zero policies (so the reader role needs
      BYPASSRLS for the quarantine too).
- [x] The default-policy key defect is real on `main`: `planConveyorRun(DEFAULT_RETENTION_POLICY)`
      → `dataObjectKey` throws `season must be YYYY or YYYY-YY; received "all"`.
- [x] The object-store client issues only PutObject, HeadObject, GetObject and ListObjectsV2, so the
      bucket policy grants no multipart or delete action.
- [x] Cron job 5 is inactive, job 2 is unchanged, and the stale deploy run is rejected.
- [x] No credential, secret, DDL, data movement or deletion is performed by this lane.

## EVIDENCE:

### 1. Live measurements (read-only, production `zfzdnfwdarxucxtaojxm`, 2026-09-24)

- Quarantine: `min/max(snapshot_at)` = 2026-04-23 02:29:46Z / 2026-04-29 13:04:29Z; per-day counts
  545,557 · 328,192 · 1,336,559 · 2,426,912 · 2,179,894 · 1,364,552 · 9,540 = 8,191,206 =
  `count(*)`.
- History: `min/max(snapshot_at)` = 2026-05-11 18:29:53Z / 2026-06-30 12:41:02Z; 60 partitions.
- RLS: `provider_offer_history` rls=true force=false policies=0;
  `provider_offers_legacy_quarantine` rls=true force=false policies=0.
- cron.job at 2026-09-24 14:22:32Z: job 2 `awaiting-approval-drift-monitor` active, command md5
  `4b158bc9d94ab940d94c0a2ee87a4b87` (unchanged); job 5 `nightly-retention-prune` active=false,
  command md5 `4bfae00f1583131f9a809af17c2a30a1` (unchanged); 137 runs, all failed.
- Deploy run 35596690418: status completed, conclusion failure; approvals: canary `rejected` by
  griff843; pending deployments 0.

### 2. Default-policy defect reproduction

```
$ tsx scripts/warehouse/zz-probe.ts   # planConveyorRun(DEFAULT_RETENTION_POLICY, today 2026-09-24) → dataObjectKey
THROWS season must be YYYY or YYYY-YY; received "all"
```

(The probe was a temporary file, deleted after the run and never committed.)

### 3. Hetzner billing statements (fetched 2026-09-24)

- https://docs.hetzner.com/storage/object-storage/overview/ — billed "regardless of how many Buckets
  you have and how many different projects or locations they are in"; charged "for every hour you
  have at least one active Bucket".
- https://docs.hetzner.com/storage/object-storage/faq/s3-credentials/ — keys and buckets in separate
  projects; "you still need at least one key pair in the same projects as your Buckets".

### 4. Repository checks on the branch

```
$ pnpm test:ops
# tests 3330
# pass 3330
# fail 0
$ tsx scripts/ci/r-level-check.ts --base decd67afaf99eeb41320c40eca14a9d9e9cf92a6 --head HEAD
Verdict: PASS
Changed files: 7
Rules matched: (none) — no R-level artifacts required for this diff
```

### Re-anchor to `7cf645ebd23d11cfdd111933f393e68ca28e2bfe`

Branch refreshed from origin/main `c76de5440` after #1636 merged. The merge brings in only main's own
changes: `.ops/sync/WORK-2026092308.yml`, `apps/api/src/model-performance-service.test.ts`, `apps/api/src/model-performance-service.ts`, `apps/api/src/t1-proof-utv2-1137-settlement-corrections.test.ts`, `docs/06_status/lanes/WORK-2026092308.json`, `docs/06_status/proof/WORK-2026092308/evidence.json`, `docs/06_status/proof/WORK-2026092308/verification.md`. Lane-scope files changed by the merge: 0. Superseded anchor, not
withdrawn: `cbdc08e3f01817ad5f0e35b4487b1c5d72654639`. `verify` re-runs on the new head.

### Re-anchor to `7cf645ebd23d11cfdd111933f393e68ca28e2bfe`

Branch refreshed from origin/main `c5ff4854f` after #1636 merged. The merge brings in only main's own
changes: `docs/06_status/lanes/WORK-2026092308.json`, `docs/06_status/proof/WORK-2026092308/evidence.json`, `docs/06_status/proof/WORK-2026092308/verification.md`. Lane-scope files changed by the merge: 0. Superseded anchor, not
withdrawn: `725ea081d97b8318fc341c2feb18b6df6ad2353a`. `verify` re-runs on the new head.

### Merge-SHA verification (added by WORK-2026092406)

The sections above record only `pnpm test:ops`. This section adds what CI ran on the merge SHA
`79a148dfa62d8c0b7d2313a4c039dfee39203c0a` (#1646). Each line names the run and job that executed
it; none of these ran locally for this lane.

- `pnpm verify` — CI splits it across two jobs of `ci.yml` run 36028634010, both `success`:
  - job `verify` (107733848362) runs its static half, `pnpm verify:static`;
  - job `Writable DB proof (staging only)` (107731452357) runs its live half, `pnpm test:live-db`, and `verify` checks that job's receipt.
- `pnpm type-check` — runs inside `pnpm verify:static` in job 107733848362, `success`.
- `pnpm test` — runs inside `pnpm verify:static` in job 107733848362, `success`.

The lane changed documentation only (four Markdown files), so none of these results depends on
its diff. They are recorded because the T2 closeout gate requires the evidence to be named.
