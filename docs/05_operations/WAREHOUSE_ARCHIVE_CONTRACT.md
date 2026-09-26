# Warehouse Archive Contract

**Status:** Active — implemented under WORK-2026092101
**Tier:** T2
**Supersedes:** nothing. Extends `docs/02_architecture/HISTORICAL_MARKET_DATA_WAREHOUSE.md`
(UTV2-1237), which was and remains the architecture recommendation; this document is the
contract for the implementation that now exists.

This contract governs how operational history leaves the hot Postgres database and becomes
a durable, queryable archive. It governs archiving and verification. **It does not authorize
a deletion of anything, ever.** What a prune requires is stated in §6 and executed nowhere in
this repository.

---

## 1. What is hot and what is archived

| Class | Home | Why |
|---|---|---|
| sports, leagues, canonical teams and players, current rosters | Supabase | resolved on every submission |
| active and current events, current offers | Supabase | the pick surface reads them live |
| bounded recent odds history | Supabase | the hot window an operator can still act on |
| picks, lifecycle, settlement truth, delivery/outbox truth, audit/business truth | Supabase | operational and legal truth; never archived out |
| current feature summaries the runtime reads | Supabase | runtime dependency |
| old provider offer history, raw provider payloads, odds/line snapshots | object storage | volume, no operational read |
| historical player stats, team stats, game-level statistical history | object storage | research and training input |
| closing-line datasets, historical results for research | object storage | research input |
| telemetry beyond operational retention | object storage | volume |
| canonical modeling datasets, feature datasets, training datasets, model artifacts | object storage | reproducibility, not operations |

Picks, settlement, delivery and audit rows are **not archivable under this contract**. They are
operational truth, they are small, and moving them would put the evidence for a member-facing
claim behind an object store.

## 2. Object layout

Implemented in `scripts/warehouse/object-layout.ts`, `LAYOUT_VERSION = 1`.

```
raw/{provider}/{sport}/{season}/{date}/part-NNNN.parquet
canonical/markets/{sport}/{season}/{date}/part-NNNN.parquet
canonical/player_stats/{sport}/{season}/{date}/part-NNNN.parquet
canonical/team_stats/{sport}/{season}/{date}/part-NNNN.parquet
canonical/results/{sport}/{season}/{date}/part-NNNN.parquet
canonical/closing_lines/{sport}/{season}/{date}/part-NNNN.parquet
features/{feature_version}/{sport}/part-NNNN.parquet
training/{dataset_version}/part-NNNN.parquet
models/{model_version}/...
manifests/{domain}/{date}/{manifest_id}.json
```

Every segment is validated against `^[a-z0-9][a-z0-9_-]*$`, seasons against `^\d{4}(-\d{2})?$`,
and dates against the real calendar. A key is therefore incapable of carrying `..`, an absolute
path or a traversal. `parseDataObjectKey` is the exact inverse of `dataObjectKey`, which is what
lets a reader recover a partition's identity from the key alone.

**Sport partitioning is opt-in per source, and off by default.** A sport-partitioned policy must
enumerate its sports; any row whose sport is not on that list would then be archived by nothing
at all. That hole widens the moment a league is added. The default policy writes one object per
day per source and leaves sport as a column DuckDB filters on.

## 3. File format

Parquet, `COMPRESSION zstd`, `ROW_GROUP_SIZE 122880`. Enforced by `buildCopySql` and asserted
against `parquet_metadata` in `export-partition.test.ts`.

The manifest records `data_schema_version`, a SHA-256 over the ordered `name:type` column list.
Two objects under the same prefix with different schema versions are not two copies of one
partition, and a reader joining across them would be silently wrong. The read path passes
`union_by_name = true` so a column added later does not drop older partitions.

## 4. Bounded export

`scripts/warehouse/export-partition.ts`:

- one **half-open** window `[start, end)` per export, never `<=`;
- a deterministic `ORDER BY` is **required** — an export with no ordering cannot be sample-verified
  positionally, so it is refused rather than exported unverifiably;
- the source is counted **before** the copy and the result counted **from the written file**
  afterwards; comparing the writer's claim against itself would prove nothing;
- `MAX_WINDOW_ROWS = 20_000_000`. A window above the bound is refused **before anything is
  written**, so a mis-specified window cannot start an unbounded read of a production table;
- relation and column names are matched against strict patterns and quoted; nothing is
  interpolated unvalidated;
- the source database is attached `READ_ONLY`.

## 5. Archive manifest

`schema_version: 1`, written by `scripts/warehouse/manifest.ts`. Required content:

| Field | Meaning |
|---|---|
| `source.relation`, `source.partition` | what was exported |
| `source.window` | `{column, start, end}`, half-open |
| `source.domain`, `source.sport` | warehouse domain and sport, where applicable |
| `source.row_count` | rows the source held |
| `export.exported_row_count` | rows counted in the written file |
| `object.byte_size` | exported size |
| `object.checksum_sha256` | SHA-256 of the exported bytes |
| `export.exporter_repo_sha` | the repo SHA that produced it |
| `export.data_schema_version`, `export.columns` | schema fingerprint and column list |
| `export.exported_at` | export timestamp |
| `verification.verified_at` | verification timestamp |
| `verification.sample_readback_rows` / `_match` | bounded sample read-back result |

`manifest_id` is `sha256(data_key)` truncated — **a pure function of the target**. That is what
makes a re-run idempotent: a second run addresses the same manifest key and finds its own work.

## 6. Fail-closed verification, and the prune gate

**A production row or partition never becomes prune-eligible because an upload returned success.**
A 200 from a PUT says a request completed. It does not say the object is there, holds the rows
you think, is the bytes you hashed, or can be read at all.

Every check re-reads the object **from the store**, never the local file the exporter wrote —
verifying the local copy would step over the upload, which is the one step that can lose data.

All six must hold, each recorded independently:

1. the manifest is structurally valid;
2. `object_exists` — present, and its size is the size the manifest claims;
3. `checksum_verified` — SHA-256 of the **downloaded** bytes equals the manifest's;
4. `parquet_readable` — DuckDB opens it and counts it;
5. `row_count_match` — source, manifest and archive counts all agree;
6. `sample_readback_match` — a bounded sample read back from the archive matches the source
   **position by position**, under the export's own ordering. A non-empty partition that sampled
   zero rows is a failure, not a vacuous pass.

`verification.passed` is a conjunction computed by `applyVerification`; no caller can set it.

`isPruneEligible` re-compares the counts rather than trusting the booleans, so a manifest
hand-edited to flip a flag still cannot open the gate. A failed verification is written to
`*.failed.json` — a key the prune gate does not read.

**Any mismatch is an archive failure and confers no deletion eligibility.**

There is no `prune` subcommand in `scripts/warehouse/cli.ts` and no delete step in
`.github/workflows/warehouse-archive-conveyor.yml`. Both absences are asserted by tests.

## 7. Read path

`scripts/warehouse/query.ts`. DuckDB reads the archived Parquet directly over the S3-compatible
API. There is no standing query service and nothing to keep running between queries.

The claim being delivered is a negative one: **a research or model-training workload answers a
real question over the archive without a production database credential.** `query.test.ts`
proves it by answering a per-day, per-sport market question from a connection that has never
seen the source and an environment holding no Supabase variable.

Per the guardrail in `HISTORICAL_MARKET_DATA_WAREHOUSE.md` §11, the representative query makes
no CLV, ROI or edge claim, and a test asserts it never acquires one.

**The read path holds the reader key only.** `warehouse query` and `warehouse doctor --research`
resolve S3 credentials only from `UNIT_TALK_WAREHOUSE_S3_READ_ACCESS_KEY_ID` /
`UNIT_TALK_WAREHOUSE_S3_READ_SECRET_ACCESS_KEY` and never fall back to the writer names. They refuse
to start when the writer key, the source DSN, or a production database credential is present, and
the refusal names each variable, never its value.

## 8. Conveyor

`scripts/warehouse/conveyor.ts`, run by `.github/workflows/warehouse-archive-conveyor.yml` at
04:17 UTC daily.

- **What it archives** — `DEFAULT_RETENTION_POLICY`, one entry per table, each at the architecture's
  hot retention:

  | Relation | Window column | Hot days | Files under |
  |---|---|---:|---|
  | `public.provider_offer_history` | `snapshot_at` | 45 | `canonical/markets/` |
  | `public.raw_payloads` | `snapshot_at` | 21 | `raw/raw_payloads/` |
  | `public.odds_snapshots` | `snapshot_at` | 45 | `raw/odds_snapshots/` |
  | `public.system_runs` | `started_at` | 90 | `raw/system_runs/` |

  A table whose shape is not a canonical domain's files under `raw/{table}/`, so no two tables ever
  share a key. A canonical entry that names no domain is refused, never filed under a guessed one.
  Run telemetry windows on `started_at` because `finished_at` is null for a run that never finished,
  and those rows would otherwise belong to no window. Every archived table is also a backfill source,
  using the conveyor's own entry, so a backfilled day and a conveyor day are one key.
- **One closed day per source per run** — `today - hotRetentionDays - 1`. A backlog stays visible
  as a backlog instead of being absorbed into one enormous export.
- **Idempotent** — a run that finds an already-verified manifest for the target's key does nothing.
- **No corrupt intermediate state on retry** — whole-object PUT for the data, and the manifest is
  written **last**, only after verification passed against the uploaded object. A run killed between
  upload and verification leaves an object with no manifest: invisible to the prune gate, and
  overwritten wholesale by the next attempt.
- **Observable** — every run writes `manifests/_conveyor/heartbeat.json`, **including a run that
  failed every window**. Conflating "failing" with "not running" is how a dead conveyor goes
  unnoticed. Staleness is read from the bucket, so it is answerable without a database credential
  and without access to the runner. A missing heartbeat is stale, never unknown.
- **Alerting** — a run with any failed window exits non-zero and carries an `alert` payload.
- **Unprovisioned is red, and says so** — `warehouse doctor` classifies the configuration as
  `not_provisioned` (no archive key set), `incomplete` (something set, but a key is missing or a
  placeholder) or `ready`, and exits 0 only for `ready`. A scheduled run before provisioning therefore
  fails at `doctor`, and its job summary states that no window was exported, uploaded, verified or
  manifested and that nothing became prune-eligible. It never exits cleanly: an archive that is not
  running is stale, never unknown.
- **The default policy names a key** — `season: 'window-year'` resolves to the window's own year, and
  key construction runs inside the per-item `try`, so a target whose key cannot be built is a failed
  window with a heartbeat, never a throw that escapes the run.
- **Prune hold** — a policy entry may carry `pruneHold`. A held source is archived and verified, and
  its result never reports prune-eligible. `decideRetentionEligibility` is the boundary any future
  prune must obey; it decides and deletes nothing.

### 8a. Historical backfill

`scripts/warehouse/backfill.ts`, run as `warehouse backfill --source … --from … --to …
[--max-windows N] [--dry-run]`, and by the same workflow as a `workflow_dispatch` with
`mode: backfill`. The schedule can never start one. Both jobs run in the `warehouse-archive`
environment and refuse unless the ref is `refs/heads/main`; dispatch inputs reach the shell only as
environment variables.

- **Bounded** — an inclusive range of UTC days, oldest first, at most 62 windows, and every window
  must already have left hot retention.
- **The conveyor's own guarantees** — each day runs as a one-item plan through `runConveyor`, so
  export, verification against the store, manifest-last and idempotency are unchanged.
- **Stop on first failure** — no later window is attempted after a failed one.
- **Its own heartbeat** — a running backfill cannot make a dead daily conveyor read as alive.
- **Progress ledger** — `manifests/_backfill/<source>/<from>_<to>.json`, an operator record the
  prune gate never reads.

Starting a production backfill is a PM-reserved action; see
`WAREHOUSE_HISTORICAL_BACKFILL_PLAN.md` §5.

## 9. What this contract does not do

- It does not activate SGO or any provider.
- It does not migrate Postgres off Supabase.
- It does not introduce a standing platform. DuckDB is a library invoked per run; there is no
  Kafka, ClickHouse, Redis, Spark or Temporal, per `HISTORICAL_MARKET_DATA_WAREHOUSE.md` §11.
- It does not delete production data, drop a partition, or weaken a migration, proof or PR control.
