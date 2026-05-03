# Hetzner Self-Hosted Architecture Scope Lock — v1

**Status:** APPROVED FOR PROVISIONING PREP (not for production cutover)
**Issue:** UTV2-785
**PM approval:** griff843, 2026-05-03
**Parent:** UTV2-770 — Hetzner cutover gate

---

## 1. Architecture baseline (approved)

| Layer | Server | Spec | Purpose |
|---|---|---|---|
| App / worker | CCX23 | Hetzner shared vCPU | API, ingestor, discord-bot, workers |
| DB | EX44 | Intel i5-13500, 64 GB DDR4, 2×512 GB NVMe (RAID-1), 1 Gbit | Postgres host |
| Local backup | BX11 Storage Box | Hetzner storage | Primary backup target |
| Off-site backup | Second provider (TBD) | Backblaze B2 / Cloudflare R2 / S3-compatible | Geo-redundant encrypted copy |

**Database split (required before cutover):**
- `unit_talk_app` — control plane: picks, approved_picks, outbox, receipts, settlements, pick_grades, governance
- `unit_talk_ingestion` — market data plane: provider_offers, provider_offer_current, provider_offer_history, provider_offer_staging, provider_cycle_status

**Critical ingestion redesign (required before cutover):**
- `provider_offer_current` — latest-snapshot view, identity contract defined in UTV2-771
- `provider_offer_history` — partitioned historical archive, retention policy in UTV2-772
- Staging + bounded-merge path already implemented (UTV2-787 base)

---

## 2. Confirmed facts (as of 2026-05-03)

| Item | Value | Source |
|---|---|---|
| EX44 setup fee | €109/server | PM-confirmed + hetzner.com |
| EX44 monthly | €49.00/month (€0.0785/hour) | hetzner.com |
| EX44 locations available | FSN1, HEL1 — in stock | hetzner.com |
| Cancellation terms | No minimum contract, immediate | hetzner.com |
| IPv4 | 1 dedicated included; optionals available | hetzner.com |
| IPv6 | Optional /64 subnet | hetzner.com |
| Bandwidth | 1 GBit/s guaranteed, unlimited traffic | hetzner.com |
| EX44 purchase decision | **PENDING PM** | UTV2-780 |

---

## 3. In scope — required before production cutover

### 3.1 Contracts and decisions (must be approved before implementation)
- [x] `provider_offer_current` identity contract — **DONE**, PR #562 (UTV2-771)
- [ ] `provider_offer_history` retention and partitioning — UTV2-772
- [ ] Ingestion DB timeout/lock/batch policy — UTV2-774
- [ ] Stale-data behavior for scanner and scoring — UTV2-775
- [ ] Postgres version decision (default PG16) — UTV2-779
- [ ] Secrets management policy — UTV2-790 (in Codex)
- [ ] Backup retention/RPO/RTO policy — UTV2-799 (in Codex)

### 3.2 Infrastructure and security
- [ ] EX44 purchase and provisioning — UTV2-786 (pending UTV2-780 purchase decision)
- [ ] Private DB networking verified — UTV2-783
- [ ] Least-privilege Postgres roles — UTV2-789
- [ ] Second-provider encrypted backup target — UTV2-791
- [ ] Ops Bot restart cooldown/rate-limit/audit — UTV2-777
- [ ] Disk growth projection alerts — UTV2-778 (in Codex)
- [ ] Docker Compose deployment/healthcheck/rollback procedure — UTV2-792

### 3.3 Ingestion redesign implementation
- [ ] `provider_offer_current` staging + bulk load + bounded merge + freshness gate — UTV2-787
- [ ] `provider_offer_history` partitioning + retention — UTV2-772
- [ ] Non-blocking raw payload archiving — UTV2-773
- [ ] Structured ingestion failure taxonomy — UTV2-797

### 3.4 Proof and verification
- [x] Supabase vs Hetzner comparison mode — **DONE**, PR #563 (UTV2-776)
- [ ] Peak NBA/NHL/MLB slate replay at 1× and 2× — UTV2-781
- [ ] Repeatable slate replay harness — UTV2-796
- [ ] WAL/PITR restore proof — UTV2-782
- [ ] Rollback rehearsal — UTV2-784

### 3.5 Product-flow and model proof
- [ ] Smart Form canonical workflow validated — UTV2-794
- [ ] posted→settled→CLV→recap workflow proved — UTV2-795
- [ ] Model performance feedback loop — UTV2-798

### 3.6 Observability
- [ ] Production health dashboard baseline — UTV2-793
- [ ] Forward migration runbook and cutover sequence — UTV2-788

---

## 4. Explicitly excluded from this scope

| Excluded | Reason |
|---|---|
| **Production cutover** | Blocked until all gates in UTV2-770 pass. Server provisioned ≠ cutover approved. |
| EX44 as the ingestion fix | Hardware alone does not fix ingestion design. Redesign is required. |
| Running production on single `provider_offers` table | Must split current-state from history before cutover. |
| Accepting `cycle ran` as freshness proof | Requires ≤5-minute freshness per active sport/provider/market under peak slate. |
| Cutting over without rollback rehearsal | Rehearsal and WAL/PITR restore proof are non-negotiable gates. |
| Model tiers as production-trusted | Must pass posted/settled outcome feedback validation first. |

---

## 5. Open questions (as of 2026-05-03)

| Question | Status | Tracking |
|---|---|---|
| Postgres version (PG16 vs PG17) | Default PG16; pending doc | UTV2-779 |
| Private networking method (Hetzner vSwitch vs firewall-only) | Pending | UTV2-783 |
| Second-provider backup target (B2, R2, S3) | Pending selection | UTV2-791 |
| Retention durations (WAL, full, logical dump) | Default in policy doc | UTV2-799 |
| EX44 purchase decision | **PM action required** | UTV2-780 |
| Off-site backup tool (WAL-G vs pgBackRest) | Deferred to implementation | UTV2-791 |

---

## 6. Issue sequencing — required order constraints

```
UTV2-771 approved (identity contract) ──► UTV2-787 (implement staging + merge)
UTV2-779 done (Postgres version)      ──► UTV2-786 (provisioning checklist)
UTV2-780 purchase decision            ──► UTV2-786 (provisioning checklist)
UTV2-786 done (provisioning)          ──► EX44 server online
UTV2-774 done (timeout policy)        ──► UTV2-787 (implementation)
UTV2-775 done (stale-data behavior)   ──► UTV2-787 (implementation)
UTV2-789 done (least-privilege roles) ──► cutover gate
UTV2-783 done (private networking)    ──► cutover gate
UTV2-782 done (WAL/PITR proof)        ──► cutover gate
UTV2-784 done (rollback rehearsal)    ──► cutover gate
UTV2-788 done (migration runbook)     ──► cutover gate
ALL UTV2-770 children done            ──► production cutover decision
```

---

## 7. PM go/no-go record

| Decision | Status | Date |
|---|---|---|
| Proceed with provisioning prep | **GO** | 2026-05-03 |
| EX44 purchase | **PENDING** — awaiting PM | — |
| Production cutover | **NO-GO** — multiple gates open | — |

---

## 8. Change policy

Changes to this scope require a new version of this document (`HETZNER_SCOPE_LOCK_V2.md`) and PM approval recorded in that document. The no-go conditions in UTV2-770 take precedence over this document.
