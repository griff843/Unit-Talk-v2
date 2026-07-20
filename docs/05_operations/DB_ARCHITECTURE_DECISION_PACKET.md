# Database Architecture Decision Packet

**Issue:** UTV2-1446  
**Decision date:** 2026-07-19  
**Decision owner:** PM  
**Packet status:** Recommended architecture submitted for PM decision  
**Scope:** Decision packet only. No purchase, provisioning, migration, data copy, DNS, secret, database configuration, or production mutation is authorized by this document.

## Executive decision

**Recommendation: adopt the hybrid architecture when PM approves spend: keep Supabase as the production OLTP authority and add one isolated Hetzner EX44-class research host for historical odds, closing-line research, multi-season backtests, and shadow-model validation.** Historical/research workloads must never query production Supabase directly.

This is the lowest-cost architecture that is responsibly deployable now and satisfies the full requirement set. It preserves managed production backups and operations while moving the workload class most likely to create storage, scan, timeout, and contention incidents away from production. Its planning cash floor is **about $2,572 for 12 months**, excluding tax, IPv4, data-transfer overages, and engineering labor.

Self-hosting both production and research is cheaper on raw infrastructure at an estimated **$1,862 for 12 months**, but it is not currently an eligible production choice. UTV2-1447 records that the migration ledger cannot rebuild a fresh database, the stated recovery targets have not been empirically proven, and backup/PITR ownership is not staffed and rehearsed. Moving production under those conditions would exchange a known managed-platform risk for an unbounded recovery risk.

Remaining on Supabase without dedicated research compute has the lowest stated cash floor, approximately **$1,658 for 12 months**, but does not meet the research-capacity and workload-isolation requirements. It is therefore a baseline, not a complete option.

## PM decision record

**Current PM disposition:** `PENDING — return this packet to PM review.`

The PM comment dated 2026-07-16 authorized creation of a current, source-linked packet and explicitly prohibited provisioning, purchase, migration, data copy, DNS, secret, or production configuration work. The recommendation above is an engineering recommendation, not a spend or data-movement approval.

PM should record exactly one disposition on UTV2-1446:

- `APPROVE HYBRID` — authorize separate implementation issues for procurement, research-host hardening, archive/export design, and verification. This does not authorize a production database migration.
- `DEFER` — keep Supabase OLTP and prohibit production research workloads; accept that model-validation work remains capacity constrained until a research host is approved.
- `RETURN` — request a revised cost or sizing model, naming the missing input.

`SELF-HOST PRODUCTION` is intentionally not an approvable disposition in this packet. It becomes eligible only after every trigger in [Self-host eligibility gate](#self-host-eligibility-gate) is satisfied and PM approves a separate T1 migration plan.

## Non-negotiable requirements

The selected path must support all of the following without research load touching production:

1. historical odds and closing-line research;
2. multi-season backtesting;
3. shadow-model validation;
4. stable production lifecycle, settlement, delivery, and audit OLTP;
5. physical or enforceably resource-isolated research/prod workloads;
6. future Tier B/C data and model growth;
7. the current App DB target of RPO <=15 minutes and RTO <=2 hours;
8. repeatable schema creation and recovery evidence before any production move.

The hot production database remains the only runtime authority for picks, lifecycle, promotion, delivery, settlement, and audit truth. Research output may inform a later governed model/policy change; it cannot write production truth directly.

## Current evidence

### Cost and growth truth

The read-only UTV2-1369 audit on 2026-07-07 found:

- **18 GB** total production database size;
- `provider_offers_legacy_quarantine` at **6.5 GB / 8.19M rows**;
- live `provider_offer_history` partitions at approximately **7.6 GB**;
- provider-offer data at approximately **78%** of total database size;
- `system_runs` at **1.2 GB / 3.38M rows**;
- `raw_payloads` at **694 MB** and `odds_snapshots` at **427 MB**;
- measured non-anomalous provider-history growth of approximately **903 MB/day** while ingestion was healthy.

The audit could not access the organization invoice or billing dashboard. This packet therefore uses official public list pricing and labels every result as a planning floor. PM must replace the Supabase estimate with the current invoice before approving spend.

Source: [Supabase usage cost truth audit](../06_status/audits/supabase-usage-cost-truth-audit.md).

### Incident truth

The recurring incident classes are not all “database capacity” failures:

- UTV2-1294: a 17.8 MB archive write held a PostgREST connection and contributed to approximately 40 hours of settlement starvation.
- Large `system_runs` scans and stale maintenance state produced 120-second statement timeouts.
- Unbounded provider history previously exhausted the free-tier storage envelope and caused REST throttling.
- UTV2-1560 confirmed a Hetzner-to-Supabase Cloudflare 502 path affecting worker claims while Supabase remained reachable from an independent client.

The durable response is workload classification and isolation, not merely a larger database. The existing architecture already classifies lifecycle/settlement writes as fail-closed and telemetry/archive writes as fail-open.

Sources: [DB maintenance and retention spec](DB_MAINTENANCE_RETENTION_SPEC.md), [DB scaling strategy](DB_SCALING_STRATEGY.md), and Linear UTV2-1560.

### Recovery truth

The repository declares App DB targets of **RPO <=15 minutes** and **RTO <=2 hours**, but the restore drill template is not populated with measured results. UTV2-1447 also records that the committed migration ledger cannot currently rebuild production schema from scratch.

This is a hard prerequisite, not an inconvenience. A self-hosted server with untested backups and a non-replayable schema is not a production recovery plan.

Sources: [backup policy](contracts/backup-policy-v1.md), [WAL/PITR restore runbook](WALPITR_RESTORE_RUNBOOK.md), and Linear UTV2-1447.

## Cost model

### Assumptions

All figures are public list-price planning estimates captured 2026-07-19 and rounded to the nearest cent. They exclude VAT/sales tax, public IPv4 charges, engineering/on-call labor, paid support, one-time data transfer, and usage above the stated assumptions.

| Input | Planning value | Source / note |
|---|---:|---|
| Supabase Pro organization | $25.00/month | [Supabase pricing](https://supabase.com/pricing) |
| Supabase Small compute | $15.00/month | Required minimum compute for PITR; paid plans include $10/month compute credit, so modeled incremental compute is $5.00/month. |
| Supabase PITR, 7 days | $100.00/month | [Supabase backup/PITR pricing](https://supabase.com/docs/guides/platform/backups). This is required to make the <=15-minute RPO credible; daily backups alone can lose up to a day. |
| Supabase disk over included 8 GB | $0.125/GB-month | [Supabase disk pricing](https://supabase.com/docs/guides/platform/manage-your-usage/disk-size). At 18 GB actual DB size, the minimum modeled overage is 10 GB = $1.25/month; actual provisioned disk may be higher. |
| Hetzner EX44-1-LTD | $72.10/month | [Hetzner 2026 price adjustment](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/), excluding IPv4 and tax; limited availability. 64 GB RAM and mirrored local NVMe make this the existing repo-standard research/DB planning class. Re-quote before purchase. |
| Hetzner BX11, 1 TB | $4.00/month planning value | [Hetzner BX11](https://www.hetzner.com/storage/storage-box/bx11/); re-quote before purchase. |
| Off-site object/backup storage, 1 TB | $6.95/month | [Backblaze B2 public pricing](https://www.backblaze.com/cloud-storage/pricing). Restore egress beyond included allowance is excluded. |

Supabase OLTP floor:

```text
$25.00 Pro + $15.00 Small - $10.00 compute credit
+ $100.00 PITR + (18 GB - 8 GB) * $0.125 disk
= $131.25/month = $1,575.00/year
```

This is a floor, not the invoice. Supabase bills provisioned disk, and compute, egress, IOPS, throughput, and other usage can increase the total. The production invoice is a required PM pre-purchase input.

### 12-month side-by-side

| Option | 12-month cash floor | Meets all requirements now? | What the estimate includes |
|---|---:|---|---|
| 1. Stay Supabase only | **$1,658.40** | **No** | Supabase OLTP floor ($1,575.00) + 1 TB off-site archive ($83.40). No dedicated research compute; multi-season backtests remain unsized or would compete with production. |
| 2. Self-host production + isolated research | **$1,861.80** | **No — prerequisites fail today** | Two EX44-class hosts ($1,730.40) + BX11 ($48.00) + 1 TB off-site copy ($83.40). One host for production and one for research; a one-host design is rejected because it fails workload isolation. |
| 3. Hybrid: Supabase OLTP + Hetzner research | **$2,571.60** | **Yes, after PM approval and implementation proof** | Supabase OLTP floor ($1,575.00) + one research EX44 ($865.20) + BX11 ($48.00) + 1 TB off-site copy ($83.40). |

Sensitivity:

- Supabase without PITR lowers the managed floor by $1,200/year, but violates the current App DB RPO target and is not a valid production comparison.
- If EX44-1-LTD is unavailable, the quote must be refreshed and the 12-month decision rerun before purchase; limited-offer availability is explicitly not guaranteed by Hetzner.
- Each additional 1 TB of B2 storage adds approximately $83.40/year before excess egress.
- A second Supabase project suitable for backtesting is not modeled because no benchmark establishes the required compute tier. It is not assumed to be free.

## Option analysis

### Option 1 — Stay Supabase only

**Shape:** Supabase remains OLTP and history is aggressively retained/partitioned/offloaded. No dedicated research database is purchased.

**Benefits**

- No production cutover or connection-string migration.
- Managed daily backups, optional managed PITR, patching, and platform operations.
- Lowest cash floor.
- Retention and archive work produces value regardless of a later hosting decision.

**Limits**

- Does not provide dedicated compute for multi-season backtests or shadow validation.
- Production remains exposed to PostgREST/Cloudflare/pooler path incidents and platform throttling.
- Research queries against production are prohibited, so this path defers research rather than enabling it.

**Incident classes**

- Eliminates none by itself.
- Partition discipline and archive offload reduce storage exhaustion, long partition scans, TOAST-heavy writes, and research contention.
- Does not eliminate bad-query `statement_timeout`; no hosting choice does.

**Effort / migration risk:** Low, approximately 1–3 engineer-weeks across separately approved retention/offload lanes; no production database cutover. Rollback is per retention/archive lane and must preserve exported data before any delete.

**Disposition:** Do not select as the complete architecture. It is the safe defer posture if PM does not approve a research host.

### Option 2 — Self-host production Postgres

**Shape:** one EX44-class host becomes production Postgres and a physically separate EX44-class host carries research. The existing Hetzner application node remains separate.

**Benefits**

- Lowest long-run infrastructure cash floor among complete architectures at current volume.
- Removes Supabase PostgREST, Cloudflare edge, spend-cap, and managed pooler from the application-to-database path.
- Full control over Postgres configuration, extensions, storage layout, retention jobs, and local network path.

**Limits and operational burden**

- Unit Talk owns OS/database patching, monitoring, capacity, replication, firewalling, certificates, backups, WAL continuity, restore drills, major upgrades, security response, and 24/7 recovery.
- PostgreSQL PITR requires a valid base backup plus a continuous WAL archive; logical dumps alone are insufficient. See [PostgreSQL 16 continuous archiving and PITR](https://www.postgresql.org/docs/16/continuous-archiving.html).
- Major upgrades require dump/restore, `pg_upgrade`, or logical replication and must be rehearsed. See [PostgreSQL 16 upgrade guidance](https://www.postgresql.org/docs/16/upgrading.html).
- Raw server cost excludes the engineering and on-call burden.

**Incident classes**

- Eliminates Supabase-specific REST throttling, Cloudflare 502, managed pooler, and provider spend-cap failure classes.
- Does **not** eliminate Postgres statement timeouts, bad queries, table/index bloat, vacuum starvation, disk exhaustion, lock contention, or operator mistakes.
- Adds backup-chain breakage, failed restore, patch drift, host loss, RAID/controller, firewall, and self-managed security incident classes.

**Effort / migration risk:** High, planning estimate 4–8 engineer-weeks after prerequisites. Requires schema replay, extension/role parity, data transfer, change capture or write freeze, integrity comparison, application cutover, observation window, and rollback. Large production objects and a currently divergent migration ledger make a “simple dump and restore” claim unsafe.

**Rollback:** Supabase must remain intact and authoritative through the observation window. Rollback returns application secrets/connections to Supabase, stops writes to the new primary, reconciles any writes accepted after cutover, and requires PM incident authority. DNS or connection-string reversal alone is not sufficient if both sides accepted writes.

**Disposition:** Future cost-optimization candidate only; blocked today by the eligibility gate below.

### Option 3 — Hybrid Supabase OLTP + isolated Hetzner research

**Shape:** production lifecycle/settlement/delivery truth stays on Supabase. A separate Hetzner host stores exported historical odds and model datasets and runs backtests/shadow validation. Data flows one way from bounded export/archive artifacts into research; research has no production write credential.

**Benefits**

- Meets all stated product/research requirements without a production database cutover.
- Removes backtests, historical scans, and bulk research ingestion from the production failure domain.
- Keeps managed production backups/PITR while migration-ledger and DR work mature.
- Provides 64 GB-class memory and local NVMe economics for backtesting without paying managed-database compute rates for bursty research.
- Creates a reversible step toward either future self-hosting or continued managed OLTP.

**Limits and operational burden**

- Highest 12-month cash floor of the three planning cases.
- Supabase-specific OLTP network/platform incidents remain possible.
- The research host still requires patching, backups appropriate to rebuild cost, capacity monitoring, and access controls, but its failure cannot corrupt production truth.
- A governed export manifest, freshness SLA, and dataset lineage are separate implementation requirements.

**Incident classes**

- Eliminates research-query contention, research-driven hot-table growth, and multi-season scan pressure against production.
- Reduces oversized archive writes when object/archive data is moved out of the OLTP write path.
- Does not eliminate Supabase network/gateway incidents or poorly bounded production queries; retention/query-diet work remains mandatory.

**Effort / migration risk:** Medium, planning estimate 1–3 engineer-weeks for procurement, host hardening, research schema/dataset export, restore/rebuild proof, monitoring, and access controls. No production authority moves.

**Rollback:** Stop export jobs, revoke the research host’s read/export credential, retain Supabase as authority, and rebuild or decommission the research host. Production writes and customer delivery are unaffected.

**Disposition:** Recommended.

## Decision matrix

Scores are 1 (worst) to 5 (best). Cost is 12-month cash only; operational cost is scored separately.

| Criterion | Weight | Supabase only | Self-host prod + research | Hybrid |
|---|---:|---:|---:|---:|
| Meets research + isolation requirements now | 25 | 1 | 1 | 5 |
| Production stability / blast-radius control | 20 | 3 | 2 | 5 |
| Recoverability proven today | 20 | 4 | 1 | 4 |
| 12-month cash cost | 15 | 5 | 4 | 3 |
| Operational staffing burden | 10 | 5 | 1 | 3 |
| Migration risk / reversibility | 10 | 5 | 1 | 5 |
| **Weighted total / 5** | **100** | **3.40** | **1.65** | **4.30** |

Self-hosting scores poorly “today,” not permanently. Once migration and recovery prerequisites are proven, its first three scores should be recalculated and it may become the lower-cost long-term winner.

## Mandatory hybrid boundaries

Any hybrid implementation issue must preserve these controls:

1. The research host receives no Supabase service-role or production write credential.
2. Production-to-research transfer is one-way through bounded exports, immutable objects, or a read-only replication/export identity approved in a separate issue.
3. Backtests and notebooks cannot connect to the production database endpoint.
4. Historical datasets carry source timestamp, export timestamp, schema version, row count, and content/manifest hash.
5. Research results cannot promote, settle, route, or mutate picks.
6. Archive failure is fail-open for settlement and fail-loud for research freshness.
7. Hot retention/offload work (UTV2-1370/1371) continues; a research host is not permission to keep unbounded history in production.

## Self-host eligibility gate

Reopen the self-host decision only when all conditions are true:

1. UTV2-1447 is Done and committed migrations build a fresh database to live-schema parity without manual DDL.
2. Two consecutive isolated restore drills meet measured App DB RPO <=15 minutes and RTO <=2 hours.
3. WAL/base-backup monitoring, encrypted local backup, and encrypted off-site backup are live and alert-tested.
4. A named primary and backup operator own patching, capacity, incident response, and restores.
5. A production-sized migration rehearsal proves schema/role/extension parity, row-count and checksum checks, cutover duration, and rollback.
6. Retention and archive lanes have bounded provider-history growth so the capacity model is based on intended hot data, not legacy quarantine.
7. PM approves a dedicated T1 migration issue and maintenance window.

After eligibility, self-hosting should be selected only if at least one economic/reliability trigger also fires:

- actual Supabase cost exceeds **$250/month for three consecutive months** after retention/offload, or is forecast to do so within one quarter;
- two or more Supabase-specific gateway/pooler/platform incidents materially affect OLTP within 90 days after client/network fixes;
- managed compute needed for OLTP costs more than the fully redundant self-host plan, including backup storage and a realistic operator budget;
- a required Postgres feature/control cannot be delivered on Supabase and PM accepts the operational ownership.

## Implementation sequence after an `APPROVE HYBRID` decision

Each item is a separate scoped issue and PM gate; this packet authorizes none of them.

1. Capture the current Supabase invoice and refresh the vendor quote.
2. Benchmark a representative multi-season backtest to confirm EX44-class CPU/RAM/disk sizing.
3. Approve and purchase the research host and backup/object-storage targets.
4. Harden the host and create a no-production-write identity boundary.
5. Define the versioned historical dataset/export manifest and freshness SLA.
6. Export a bounded dataset; prove counts, hashes, lineage, and reproducible rebuild.
7. Run shadow/backtest workloads only on the research host and prove zero production DB connections.
8. Continue UTV2-1370/1371 retention and archive work independently.
9. Review actual 30/90-day costs and incidents against the self-host triggers.

## Verification and review checklist

- [x] Three required options compared.
- [x] 12-month public-price planning floor for each option.
- [x] Incident classes eliminated, retained, and introduced.
- [x] Operational burden and backup/PITR ownership.
- [x] Migration effort, risk, and rollback.
- [x] Explicit recommendation and trigger conditions.
- [x] Research/prod isolation treated as mandatory.
- [x] No migration or infrastructure action authorized.
- [ ] PM disposition recorded on UTV2-1446.
- [ ] Current Supabase invoice substituted for the public-price floor before spend approval.
- [ ] Hetzner availability/quote refreshed before purchase.
