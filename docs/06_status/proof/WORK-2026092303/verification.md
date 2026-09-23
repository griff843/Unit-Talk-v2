# PROOF: WORK-2026092303

MERGE_SHA: pending merge

Generated at: 2026-09-23T09:30:00.000Z
Issue: WORK-2026092303
Tier: T2
Lane type: governance
Branch: claude/work-2026092303-warehouse-row-security-guard
Head SHA: b9b6a00f7fa94377384cf765955278ed36b58b66
result: pass

## ASSERTIONS:

- [x] The warehouse conveyor refuses a source relation that row-level security filters for
      the connected role. `assertSourceNotRowFiltered` asks the source server
      `row_security_active(<relation>::regclass)` through `postgres_query`, and throws
      `row_security_filtered` when the answer is `true`.
- [x] An answer that is neither `true` nor `false` fails closed with
      `row_security_unknown`. It is never read as "not filtered".
- [x] The guard runs in `cli.ts` once per distinct planned relation, **before**
      `runConveyor`. So nothing is exported, uploaded or manifested for a filtered source.
- [x] Why it matters: production `provider_offer_history` has RLS enabled on the parent and
      on all 60 partitions, with **no policy**. A SELECT-only reader would read zero rows
      without an error. Verification would then compare 0 = 0 and pass an empty,
      checksummed archive. A count comparison cannot catch that loss, so the guard checks
      for it before any count is taken.
- [x] Mutation drill: each of three independent mutations inverts exactly one distinct
      test. The restored tree passes 108/108.
- [x] The documents record the measured 2026-09-23 read-only production audit:
      - `PRODUCTION_DB_SIZING_AUDIT.md` §6
      - `FIRST_ARCHIVE_CANDIDATE_PACKET.md` §3 (Q1–Q9) and §3a
      - `WAREHOUSE_OBJECT_STORAGE_PROVISIONING.md` (BYPASSRLS reader role)
      - `SGO_REACTIVATION_GATE.md` §G
- [x] The armed nightly prune is recorded, not changed. pg_cron job 5
      (`nightly-retention-prune`, `0 3 * * *`) calls
      `drop_old_provider_offer_history_partitions(7)` and `prune_provider_offers_bounded`.
      All 136 of its recorded runs failed on the `audit_log` immutability trigger and
      rolled back. That failure is the only reason the data is intact. Deactivating the job
      is an owner action and is not attempted here.
- [x] The `warehouse_reader` role SQL is **prepared, not executed**. Creating a production
      role is reserved to the owner.
- [x] No production write of any kind:
      - no DDL, migration or role creation
      - no cron change
      - no row deleted and no partition dropped
      - no archive run
      - no SGO activation
      - the quarantine table is untouched

## EVIDENCE:

### 1. Mutation drill — the guard and its wiring

Three mutations were applied to the working tree one at a time. Each was restored with
`git checkout` before the next.

```
== M1: filtered source accepted  (active === true treated as pass)
not ok 57 - a source role that row security filters is refused before any count is taken
# pass 107
# fail 1
== M2: unknown answer accepted   (row_security_unknown branch returns)
not ok 58 - an unreadable row-security answer fails closed
# pass 107
# fail 1
== M3: guard unwired from cli    (assertSourceNotRowFiltered call removed)
not ok 18 - the conveyor refuses a row-security-filtered source before exporting anything
# pass 107
# fail 1
== restored
# pass 108
# fail 0
```

### 2. Production audit (read-only, `zfzdnfwdarxucxtaojxm`, 2026-09-23 ~04:35Z)

- **Total size:** 18 GB.
- **`provider_offer_history`:** 8,106 MB across 60 daily partitions (p20260502..p20260630),
  25 of them non-empty.
- **`provider_offers_legacy_quarantine`:** 6,531 MB, an estimated 8.19M rows, with no
  inbound FKs.
- **The `provider_offers` view over the quarantine is updatable and insertable.** So SGO
  reactivation must repoint writes first (`SGO_REACTIVATION_GATE.md` §G).
- **pg_cron job 5:** 136/136 recorded runs FAILED on `audit_log is immutable`, and each
  whole command rolled back. The evidence: all 60 partitions back to 2026-05-02 survive,
  and the quarantine rows are intact.
- **Limits of this audit:**
  - The 01:46Z restart reset the counters, so scan counts cover about 3 hours.
  - `ANALYZE` was not run, because it is a maintenance operation.

### R-level

```
$ npx tsx scripts/ci/r-level-check.ts --base f041b9261a660fd8e91134000f50676374703a11 --head b9b6a00f7fa94377384cf765955278ed36b58b66
Verdict: PASS
Changed files: 11
Rules matched: (none) — no R-level artifacts required for this diff
```

## Verification
- [x] `pnpm type-check`: exit 0
- [x] `pnpm lint`: exit 0
- [x] `pnpm exec tsx --test scripts/warehouse/*.test.ts`: 108 pass, 0 fail
- [x] `ops:preflight` (PB2 runs the full `pnpm test`): PASS, 38 checks
- [x] Mutation drill: each of the 3 mutations inverts exactly one test
- [ ] `pnpm verify`: cannot exit 0 from a containment-isolated checkout.
      `ci:assert-staging` refuses because `local.env` pins `SUPABASE_URL` to loopback.
      CI runs `verify` on the PR.

## Runtime Verification

This lane is T2. The code change is a pre-export refusal in an operator-dispatched CLI, and
that CLI has never run against production. Object storage and the reader role are not
provisioned; both are owner actions. The lane adds no write path.

The runtime facts behind the documents were measured read-only against production and are
recorded above. No live-DB write proof is claimed.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Execution SHA: 9fb40cd5661c17f3f575445eed3c4a49083bdcd6
