# Warehouse Historical Backfill — Plan

**Status:** Design — WORK-2026092405. **Authorizes no data movement.** Starting a production
backfill is a PM-reserved action (large production backfill), and so is any prune.
**Governing contract:** [`WAREHOUSE_ARCHIVE_CONTRACT.md`](WAREHOUSE_ARCHIVE_CONTRACT.md).
**Credentials and bucket:** [`WAREHOUSE_OBJECT_STORAGE_PROVISIONING.md`](WAREHOUSE_OBJECT_STORAGE_PROVISIONING.md).

---

## 1. Why a backfill is needed at all

The daily conveyor (`scripts/warehouse/conveyor.ts`) archives exactly one window per source per
run: the day that has just left hot retention, `today - hotRetentionDays - 1`. With a 45-day
window that is 2026-08-09 on 2026-09-24. All existing history is **older**, and ingestion has
been parked since 2026-06-30, so the conveyor would archive an empty day every night forever and
never reach a single existing row. The existing data reaches the warehouse only through a
bounded, explicit backfill.

## 2. PM decisions this plan implements (2026-09-24)

1. Hot retention is **45 days**, not 7.
2. No production row or partition is prune-eligible unless its archive has been written **and
   independently verified**. An attempted, or even successful, upload never makes anything
   prune-eligible.
3. `provider_offer_history` is archived.
4. `provider_offers_legacy_quarantine` is archived.
5. The quarantine is **not pruned** — not even after its archive verifies. It carries a standing
   prune hold (§6).
6. Cron job 5 `nightly-retention-prune` was **deactivated by Griff on 2026-09-24**
   (`cron.alter_job(5, active := false)`, verified 14:22:32Z). It is not re-enabled until PM
   approves a verified replacement retention design. Nothing in this plan re-enables it.

## 3. What will be archived (measured 2026-09-24, read-only)

### 3a. `provider_offer_history` — 2026-05-11 → 2026-06-30

Daily range partitions `p20260502` … `p20260630` (60 partitions). Per-day row counts below are
**planner estimates** (`pg_class.reltuples`); the backfill counts every window exactly and
verifies against that exact count, never against this table.

| Window (UTC day) | est. rows | Window | est. rows | Window | est. rows |
|---|---:|---|---:|---|---:|
| 2026-05-11 | 66,476 | 2026-06-10 | 71,579 | 2026-06-22 | 173,832 |
| 2026-05-12 | 87,252 | 2026-06-11 | 61,474 | 2026-06-23 | 266,826 |
| 2026-05-13 | 37,235 | 2026-06-12 | 90,209 | 2026-06-24 | 2,741,560 |
| 2026-05-17 | 394,882 | 2026-06-13 | 31,178 | 2026-06-25 | 637,398 |
| 2026-05-18 | 50,431 | 2026-06-17 | 46,049 | 2026-06-26 | 1,689,529 |
| 2026-05-21 | 12,134 | 2026-06-18 | 70,020 | 2026-06-27 | 1,744,048 |
| 2026-06-07 | 49,335 | 2026-06-19 | 7,948 | 2026-06-28 | 1,931,531 |
| 2026-06-08 | 16,233 | 2026-06-20 | 7,436 | 2026-06-29 | 1,605,484 |
| | | 2026-06-21 | 55,409 | 2026-06-30 | 1,913,971 |

26 days hold data; the other 25 days in the range are empty. Window column: `snapshot_at`.
Ordering: `snapshot_at, id`. Largest window ≈ 2.74M rows, inside `MAX_WINDOW_ROWS` (20M).

### 3b. `provider_offers_legacy_quarantine` — 2026-04-23 → 2026-04-29

Unpartitioned table, about 6.5 GB. Counts are **exact** (`count(*)` grouped by UTC day of
`snapshot_at`) and sum to the table's 8,191,206 rows, so the seven windows cover every row.
`created_at` spans the same seven days.

| Window (UTC day) | rows |
|---|---:|
| 2026-04-23 | 545,557 |
| 2026-04-24 | 328,192 |
| 2026-04-25 | 1,336,559 |
| 2026-04-26 | 2,426,912 |
| 2026-04-27 | 2,179,894 |
| 2026-04-28 | 1,364,552 |
| 2026-04-29 | 9,540 |

Window column: `snapshot_at` (btree-indexed, `provider_offers_snapshot_at_idx`). Ordering:
`snapshot_at, id`.

The two sources do not overlap in time: the quarantine ends 2026-04-29 13:04Z, and history
begins 2026-05-11 18:29Z.

## 4. Mechanics

The backfill is a thin driver over the conveyor that already exists. It does **not** reimplement
export, manifest, verification or idempotency.

For one source and an explicit inclusive `[from, to]` range:

1. **Plan.** Enumerate every UTC day from `from` to `to`, **oldest first**. Refuse if `from > to`,
   if either bound is not an ISO date, or if the range exceeds **62 windows** — the largest
   bounded run this plan needs is 51 days (3a). A larger range is split by the caller.
2. **One window at a time.** Each day is run as a one-item conveyor plan through `runConveyor`,
   so it gets the conveyor's existing guarantees unchanged:
   - `assertSourceNotRowFiltered` refuses a role whose RLS would read zero rows;
   - an exact source `count(*)` is taken, the window is exported to Parquet in `snapshot_at, id`
     order, and checksummed;
   - the object is written with one whole-object PUT;
   - verification runs **against the store, not the local file**: the object is downloaded,
     its sha256 is compared, the Parquet is opened, the archive row count is compared with the
     manifest and the source, and a sample is read back and compared row by row;
   - the manifest is written **last**, and only if every check passed. A failed verification
     writes `…failed.json`, a key the prune gate never reads.
3. **Stop on first failure.** If a window's status is `failed`, the driver stops. No later window
   is attempted. The run exits non-zero and reports the failing window and its failures.
4. **Empty windows.** A day with zero source rows is archived as a verified zero-row object with
   its manifest, so "this day was empty" is itself recorded evidence rather than an absence. The
   RLS guard in step 2 is what stops a zero-row read by a filtered role from passing as empty.
5. **Progress ledger.** After every window, the driver rewrites
   `manifests/_backfill/<source-slug>/<from>_<to>.json` with each window's status, row counts,
   bytes and manifest key. It is an operator record. The prune gate does not read it, and it cannot
   vouch for any object.

### Deterministic object names

| Source | Data object | Manifest |
|---|---|---|
| `provider_offer_history` | `canonical/markets/all/<YYYY>/<date>/part-0000.parquet` | `manifests/markets/<date>/<id>.json` |
| `provider_offers_legacy_quarantine` | `raw/provider_offers_legacy/all/<YYYY>/<date>/part-0000.parquet` | `manifests/raw_provider_offers_legacy/<date>/<id>.json` |

`<YYYY>` is the window's year (§7, defect 1). The manifest id is `computeManifestId(dataKey)`, a
pure function of the key. History uses the **same** key the daily conveyor uses, so a backfilled
day and a conveyor day can never become two archives of one window.

The quarantine is filed under `raw/provider_offers_legacy/` rather than `canonical/markets/`. The
two tables have different shapes, and a shared namespace would put two tables' objects under one
key whenever their dates met. Keeping them apart makes that collision impossible by construction,
not merely absent from today's dates. `raw/{provider}/…` already exists in `LAYOUT_VERSION = 1`,
so no layout change is needed.

### Retry and idempotency

Re-running the same range is the retry. A window whose manifest exists and passes `decidePrune`
is skipped (`skipped_already_verified`) without reading the source. A window interrupted after its
upload has no manifest, so it is re-exported and its object overwritten wholesale. A window whose
earlier manifest is unparseable is treated as absent, never as a pass. No state outside the bucket
decides what is done.

## 5. Running it

Only from `main`, through the `warehouse-archive` GitHub environment (provisioning doc §6), as a
`workflow_dispatch` with inputs `source`, `from`, `to` and `max_windows`. It uses the **writer**
key and the read-only `warehouse_reader` DSN.

Proposed sequence, each step a separate PM-visible dispatch:

1. **Pilot:** `provider_offer_history`, `2026-05-11 → 2026-05-11`, `max_windows 1` (about 66k
   rows). Confirm the manifest verifies and the bucket stays private.
2. **History:** `2026-05-11 → 2026-06-30`. Oldest first, so the small May windows run before the
   2–3M-row late-June windows.
3. **Quarantine:** `2026-04-23 → 2026-04-29`.

Acceptance for each step: every window `archived` or `skipped_already_verified`; zero `failed`;
for every data window the manifest's `source.row_count` equals `export.exported_row_count`; and a
read through the **reader** key (`pnpm warehouse query`) returns the same count.

## 6. Prune eligibility and the quarantine hold

The backfill **never deletes, drops or detaches anything**. There is no prune path in this
repository, and this plan adds none.

When a replacement retention design is brought to PM, it must satisfy all of the following:

- a history partition is prune-eligible only if its day is older than 45 days **and** a manifest
  for that exact window exists **and** `decidePrune(manifest).eligible` is true when the prune
  runs, not when the upload ran;
- `provider_offers_legacy_quarantine` is **never** prune-eligible while the PM hold stands,
  whatever its manifests say. The hold is data in the policy (`pruneHold`), so a prune
  implementation that forgets it fails a test rather than silently deleting the table;
- the `audit_log` statement that makes job 5 fail today is not "fixed" in isolation. Repairing it
  alone would turn job 5 into an unarchived-data drop.

## 7. Defects this plan found, and the implementation it waits on

**Defect 1: the conveyor's default policy cannot produce a key.** `DEFAULT_RETENTION_POLICY` sets
`season: 'all'`. `object-layout.ts` accepts only `YYYY` or `YYYY-YY`, so `dataObjectKey` throws
`season must be YYYY or YYYY-YY; received "all"` for the only production policy entry. Reproduced
on `main` 2026-09-24 with a probe run through `planConveyorRun` → `dataObjectKey`. The conveyor
tests pass because they use `season: '2026'`. `dataObjectKey` is called **before** the per-item
`try` in `runConveyor`, so the throw escapes the run: no failed-item result is recorded and no
heartbeat is written. Fix: derive the season from the window's year (`date.slice(0, 4)`, as the
policy type's own comment already anticipates), move key construction inside the per-item `try`,
and add a test that runs `DEFAULT_RETENTION_POLICY` itself through `dataObjectKey`.

**Implementation, one runtime-free lane, T2:**

- `scripts/warehouse/conveyor.ts`: the season fix and the `try` placement; a `target` override on a
  plan item (for `raw/provider_offers_legacy`); `pruneHold` on `RetentionPolicyEntry`.
- `scripts/warehouse/backfill.ts` and `backfill.test.ts`: the planner (bounds, oldest-first) and the
  driver (one window per `runConveyor`, stop on first failure, ledger).
- `scripts/warehouse/cli.ts`: a `backfill` subcommand.
- `.github/workflows/warehouse-archive-conveyor.yml`: a `workflow_dispatch` backfill mode.
- `package.json`: register `backfill.test.ts`.

Tests are named before code: range refusal (`from > to`, more than 62 windows, non-ISO bounds);
oldest-first ordering; stop-on-first-failure (window 2 fails, so window 3 is never exported);
re-run skips verified windows and exports nothing; an interrupted upload with no manifest is
re-exported; an empty window yields a verified zero-row manifest; history and quarantine keys
never collide; a `pruneHold` entry is never reported prune-eligible; `DEFAULT_RETENTION_POLICY`
produces a valid key.

**Waiting on:** #1643 (locks `cli.ts`, `config.ts`, the conveyor workflow), #1642 (locks
`conveyor.test.ts`) and #1644 (locks `package.json`). All three wait on #1636.

**Source role:** `warehouse_reader` also needs `SELECT` on
`public.provider_offers_legacy_quarantine`, which has RLS in the same state as history and needs
the same `BYPASSRLS` role. The grant is added to the prepared DDL in the provisioning doc. It is
production DDL, and so reserved.
