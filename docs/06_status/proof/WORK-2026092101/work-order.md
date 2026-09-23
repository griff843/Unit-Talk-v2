# WORK-2026092101 — Historical market-data warehouse foundation

Repo-owned work order (tracker independence, ratified 2026-09-05). No Linear issue
exists for this identity by design.

## Objective

- Build the foundation that lets Unit Talk ingest high-volume SGO history (NFL, NCAAF,
  NBA, NCAAB, NHL, MLB, player props, player stats, team stats) without growing the
  production Supabase OLTP database without bound.
- Supabase stays the hot operational database. Historical and high-volume time-series
  data moves to private S3-compatible object storage as Parquet + zstd.
- Research and model-training workloads must be able to read that history without a
  production write credential.

## Acceptance Criteria

- A bounded partition exporter exists under `scripts/warehouse/` and is tested: it reads
  a closed window, writes Parquet with zstd compression, and never loads a
  production-sized relation into memory unbounded.
- Representative data produces a valid, readable Parquet object under the durable object
  layout (`raw/`, `canonical/`, `features/`, `training/`, `models/`, `manifests/`).
- An archive manifest is generated deterministically and records at minimum: source
  relation/partition, window, sport/domain, source row count, exported row count,
  exported byte size, SHA256 checksum, exporter repo SHA, schema version, export
  timestamp, verification timestamp, and a sample read-back result.
- Verification is fail-closed: count mismatch, checksum mismatch, missing object,
  unreadable Parquet, sample read-back mismatch, or a missing/unverified manifest each
  make the partition ineligible for prune, proven by tests that break exactly one thing.
- An archived partition is queryable through DuckDB over the S3-compatible API with no
  production Supabase connection, proven by a test asserting the query used no
  production database.
- A scheduled archive conveyor exists with deterministic idempotent keys, a heartbeat
  written to the bucket, staleness detection, and retry that cannot leave duplicate or
  half-written object state.
- Object-storage configuration is private and secret-safe: no bucket is public, no
  secret value appears in the repository, and every credential is a GitHub secret.
- `pnpm verify` is green and the full warehouse test battery passes.
- A production-readiness packet for the FIRST archive operation is prepared for owner
  review, and no destructive production action was taken.

## Guardrails

- No production delete, no partition drop, no prune execution in this lane.
- The production sizing audit is READ-ONLY; no mutation from the audit.
- No weakening of migration, proof, PR or merge controls.
- No interference with the concurrent production-recovery and deploy work.
- Existing enforcement stays active; nothing is written directly to `main`.

## Non-Goals

- Activating SGO or any provider ingestion.
- Subscribing to or rotating provider credentials.
- Migrating production Postgres off Supabase.
- Introducing Kafka, ClickHouse, Redis, Spark, Temporal or any other standing platform.
- Deleting `provider_offers_legacy_quarantine` or any other relation.
- Modifying unrelated product behaviour.

## Required Evidence

- `docs/06_status/proof/WORK-2026092101/diff-summary.md`
- `docs/06_status/proof/WORK-2026092101/verification.md`
- `docs/06_status/proof/WORK-2026092101/evidence.json`
- Full warehouse test-suite output, including the fail-closed verification battery and
  the DuckDB read-back proof.

## Exit Criteria

- The lane's PR is open on green CI with the evidence above bound to the merge SHA.
- The first-archive-candidate packet, the object-storage provisioning packet and the SGO
  reactivation gate are written and reviewable.
- Confirmation in the return packet that no production data was deleted.
