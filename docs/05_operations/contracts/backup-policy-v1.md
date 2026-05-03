# Backup Retention, RPO/RTO, and Restore Verification Policy v1

Issue: UTV2-799

## 1. Scope

This policy covers the Hetzner self-hosted Unit Talk V2 deployment running on the EX44 dedicated database server with 2x512 GB NVMe SSDs in Software-RAID 1.

The deployment has two logical PostgreSQL databases:

- App DB: critical operational data, including picks, lifecycle state, distribution outbox, distribution receipts, settlement records, audit records, and related app tables.
- Ingestion DB: provider offers, staging tables, provider replay state, and ingestion freshness metadata. This data is lower priority because provider data can be rebuilt from SGO/Odds API replay where replay coverage exists.

This policy defines backup targets, minimum backup cadence, retention windows, RPO/RTO targets, restore verification, alerting, and raw odds pruning requirements. It does not select the final backup implementation tool. `pg_basebackup` plus WAL-G or pgBackRest are acceptable candidate approaches; the implementation issue must ratify the final tool and exact operational commands.

## 2. RPO/RTO Targets

| Database | Criticality | RPO target | RTO target | Notes |
|---|---:|---:|---:|---|
| App DB | Critical | <= 15 minutes by default | <= 2 hours for MVP by default | PM may ratify stricter or looser targets. Recovery must preserve lifecycle, outbox, receipts, settlement, and audit consistency. |
| Ingestion DB | Rebuildable | <= 24 hours by default | <= 24 hours by default | Lower priority than App DB. Data can be replayed from SGO/Odds API where provider replay is available. Freshness metadata and replay checkpoints must be recoverable enough to resume ingestion safely. |

## 3. Retention Schedule

| Backup class | Minimum cadence | Minimum retention | Required scope |
|---|---:|---:|---|
| Full physical backups | Daily | 14 days local Hetzner target; 30 days off-site target | App DB and Ingestion DB. MVP minimum is daily full backups. |
| WAL/PITR archives | Continuous archiving | 7 days local Hetzner target; 14 days off-site target | App DB must support point-in-time recovery to meet the <= 15 minute RPO. Ingestion DB WAL retention may be relaxed only if replay checkpoints and provider replays can satisfy its RPO. |
| Logical dumps | Daily | 14 days local Hetzner target; 30 days off-site target | Schema plus critical operational tables for App DB; representative ingestion metadata and freshness tables for Ingestion DB. Logical dumps are secondary recovery artifacts, not a replacement for physical backups plus WAL/PITR. |
| Critical configs | On every config change and daily snapshot | 30 days local Hetzner target; 90 days off-site target | PostgreSQL config, backup tool config, restore scripts, systemd units, firewall rules, environment variable templates without secrets, and deployment metadata required to rebuild the DB host. |
| Raw payload metadata | Daily | 30 days local Hetzner target; 30 days off-site target | Provider/source, event IDs, ingestion timestamps, replay cursor/checkpoint metadata, and payload hashes. Full raw odds payload history is excluded beyond the pruning window in Section 7. |

Retention windows are minimums. Increasing retention is allowed only after confirming Storage Box and off-site capacity, restore time impact, privacy/compliance risk, and raw odds pruning behavior.

## 4. Backup Storage Targets

Backups must be written to at least two encrypted targets:

1. Local Hetzner target: BX11 Storage Box in the same provider environment for fast operational restores.
2. Second off-site provider: encrypted geo-redundant storage outside Hetzner, such as Backblaze B2, Cloudflare R2, or AWS S3.

The off-site provider is mandatory before the deployment is considered production-resilient. Implementation placeholder: create/link the follow-up issue for selecting the second provider, provisioning encrypted buckets, configuring credentials, and proving restore from the off-site target.

All backup objects must be encrypted at rest. Credentials for backup targets must not be stored in repository files. Access must be scoped to backup write/read operations and rotated when an operator with access leaves the project.

## 5. Restore Verification Runbook

Restore verification must run in two modes:

- Daily automated check: restore the latest backup chain into an isolated verification database or host, apply WAL/PITR to the newest safe recovery point, and execute integrity checks.
- Mandatory post-migration check: after every database migration, run a restore verification against a backup taken after the migration reaches the target environment.

Minimum verification scope:

- App lifecycle tables: `picks`, `pick_lifecycle`, `audit_log`.
- Distribution tables: `distribution_outbox`, `distribution_receipts`.
- Settlement tables: `settlement_records`.
- Representative ingestion freshness tables: provider offer/staging freshness tables, replay checkpoints, and raw payload metadata tables used to resume ingestion.

The restore check must validate:

- The restored database starts cleanly and accepts read queries.
- App DB data is internally consistent across picks, lifecycle records, outbox rows, receipts, settlements, and audit references.
- Recent App DB data can be recovered within the current RPO target.
- Ingestion DB freshness tables and replay checkpoints are present and recent enough for the ingestion RPO.
- The restore process duration is tracked against the relevant RTO target.
- Verification output is recorded with timestamp, backup object identifiers, restore target, check result, and failure reason when applicable.

Failed restore checks are treated as backup incidents until a passing restore is captured.

## 6. Alert Policy

Backup failure alerts:

- Page the on-call infrastructure owner immediately when a scheduled full backup fails, WAL/PITR archiving stops, a backup target write fails, encryption fails, or backup age exceeds the RPO budget.
- The on-call owner must confirm whether the App DB RPO is still protected, restore backup flow if possible, and escalate to the PM when the App DB has no valid recovery point inside the RPO target.
- If the local target fails but off-site remains current, the incident remains active until local redundancy is restored.
- If both backup targets are stale or failing, treat the deployment as operating without verified recoverability.

Restore-check failure alerts:

- Page the on-call infrastructure owner immediately when the daily automated restore check fails or the mandatory post-migration restore check fails.
- The on-call owner must preserve logs, identify whether the failure is backup corruption, missing WAL, restore automation failure, schema drift, credential failure, or capacity failure.
- The PM must be notified when App DB restore verification is failing, when RTO cannot be met, or when the latest verified restore is older than 24 hours.
- No migration lane should be marked complete after a failed mandatory post-migration restore check until a passing check is recorded or a PM-approved exception is documented.

## 7. Raw Odds Pruning Policy

Raw odds history must not be retained forever inside database backups.

The Ingestion DB must prune full raw odds payload rows after 14 days by default. After that window, retain only compact replay and audit metadata needed for debugging and rebuilds: provider/source, event IDs, market identifiers, ingestion timestamps, replay cursor/checkpoint values, payload hashes, and freshness summaries.

The raw payload pruning job must run before daily backup retention creates long-lived backup copies. If raw payload retention needs to exceed 14 days, the PM must explicitly approve the new window and the implementation owner must update storage sizing, backup retention estimates, and restore verification expectations.

Backups must not be used as a workaround to preserve unbounded raw odds history. Old backups that contain raw payloads beyond the ratified retention window must expire under the retention schedule and must not be copied into longer-term archives.

## 8. Open Decisions

- Final backup implementation tool: pg_basebackup plus WAL-G, pgBackRest, or another ratified PostgreSQL-native backup tool.
- Final second off-site provider: Backblaze B2, Cloudflare R2, AWS S3, or another provider approved for encrypted geo-redundant storage.
- Final restore verification environment: isolated database on the EX44 host, separate Hetzner host, containerized verification target, or off-site restore target.
- Exact table list for representative ingestion freshness checks after the ingestion schema is finalized.
- Whether App DB RPO/RTO defaults should become stricter after MVP.
- Whether Ingestion DB targets should vary by sport, provider, or event criticality.
