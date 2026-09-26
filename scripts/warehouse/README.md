# `scripts/warehouse` — historical data warehouse

Moves closed operational history out of the hot Supabase database and into a private
S3-compatible object store as Parquet + zstd, verifies what it uploaded, and makes the result
queryable **without a production database credential**.

Contract: [`docs/05_operations/WAREHOUSE_ARCHIVE_CONTRACT.md`](../../docs/05_operations/WAREHOUSE_ARCHIVE_CONTRACT.md).
Architecture: [`docs/02_architecture/HISTORICAL_MARKET_DATA_WAREHOUSE.md`](../../docs/02_architecture/HISTORICAL_MARKET_DATA_WAREHOUSE.md).

**There is no prune. Nothing here deletes anything.** Adding a delete is a PM-gated decision, and
its preconditions are `WAREHOUSE_ARCHIVE_CONTRACT.md` §6.

---

## Modules

| File | Responsibility |
|---|---|
| `object-layout.ts` | the key space, and the only place a key is constructed or parsed |
| `config.ts` | environment resolution, presence reporting, secret redaction |
| `object-store.ts` | `ObjectStore` over S3 or a local directory; SHA-256 helpers |
| `duckdb.ts` | connection, extension loading, S3 secret configuration, quoting |
| `export-partition.ts` | one bounded window → one Parquet file, measured from the file |
| `manifest.ts` | the archive manifest, its validation, and the prune gate |
| `verify-archive.ts` | fail-closed verification against the uploaded object |
| `conveyor.ts` | the scheduled daily run: plan, export, upload, verify, manifest, heartbeat |
| `backfill.ts` | a bounded, dispatched range of past days through the conveyor's own path |
| `query.ts` | DuckDB over the bucket; the representative analytics query |
| `db-audit.ts` | read-only sizing/retention audit and candidate assessment |
| `cli.ts` | `pnpm warehouse <subcommand>` |

The daily policy archives `provider_offer_history` (45 days hot, `canonical/markets/`),
`raw_payloads` (21), `odds_snapshots` (45) and `system_runs` (90), the last three under
`raw/{table}/`. Each is also a `backfill --source`.

## Usage

```bash
pnpm warehouse doctor                    # configuration presence — never values
pnpm warehouse plan                      # what today's run would archive
pnpm warehouse conveyor --dry-run        # same, through the conveyor's own path
pnpm warehouse conveyor                  # archive + verify + manifest
pnpm warehouse staleness                 # read the heartbeat from the bucket
pnpm warehouse query --prefix canonical/markets
pnpm warehouse verify --manifest manifests/markets/2026-08-06/m....json
pnpm warehouse audit --top 40            # read-only sizing audit
pnpm warehouse candidate --relation public.provider_offers_legacy_quarantine --time-column snapshot_at
```

Configuration and provisioning:
[`docs/05_operations/WAREHOUSE_OBJECT_STORAGE_PROVISIONING.md`](../../docs/05_operations/WAREHOUSE_OBJECT_STORAGE_PROVISIONING.md).

## The five properties the tests exist to hold

1. **An upload is not an archive.** Verification re-downloads the object and checks existence,
   size, checksum, readability, row count and a positional sample read-back. Any mismatch is a
   failure and confers no deletion eligibility (`verify-archive.test.ts`).
2. **The prune gate reads the manifest and nothing else**, and re-compares the counts rather than
   trusting the booleans, so a hand-edited manifest still cannot open it.
3. **Bounded.** One half-open day per source per run, a required `ORDER BY`, and a hard row cap
   that refuses before writing anything.
4. **Idempotent and retry-safe.** Keys are pure functions of the target; the manifest is written
   last, only after verification passed. An interrupted run leaves an object with no manifest —
   invisible to the prune gate and overwritten by the next attempt.
5. **Readable without production.** `query.test.ts` answers a market question from a connection
   that has never seen the source, with no Supabase variable in its environment.

## Local development

```bash
UNIT_TALK_WAREHOUSE_LOCAL_ROOT=/tmp/unit-talk-archive pnpm warehouse plan
```

`createObjectStoreFromEnv` uses a local directory **only** when that variable is explicitly set.
There is no implicit fallback: a misconfigured production run fails rather than quietly archiving
to the runner's disk and reporting success.
