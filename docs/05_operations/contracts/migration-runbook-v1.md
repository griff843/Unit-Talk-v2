# Supabase → Hetzner Migration Runbook — v1

**Status:** DRAFT — requires PM approval before rehearsal or production cutover
**Issue:** UTV2-788
**Parent:** UTV2-770

> This runbook defines the forward cutover sequence. It does not authorise production cutover — that requires all UTV2-770 gates to pass and explicit PM sign-off.

---

## 0. Pre-conditions (all must be green before starting)

- [ ] All UTV2-770 child issues complete or PM-deferred
- [ ] Supabase vs Hetzner comparison mode passed (`pnpm db:compare`)
- [ ] WAL/PITR restore proof passed (UTV2-782)
- [ ] Rollback rehearsal passed (UTV2-784)
- [ ] Peak slate replay passed at 1× and 2× (UTV2-781)
- [ ] Private DB networking verified (UTV2-783)
- [ ] Least-privilege roles implemented (UTV2-789)
- [ ] Secrets loaded to Hetzner server (UTV2-790)
- [ ] Second-provider backup target configured (UTV2-791)
- [ ] Docker Compose deployment procedure validated (UTV2-792)
- [ ] PM go/no-go for production cutover recorded in this document (§9)

---

## 1. Maintenance window

| Parameter | Value |
|-----------|-------|
| Planned duration | 2–4 hours |
| Maximum window | 6 hours before automatic rollback |
| Low-traffic window | Weekday 04:00–08:00 UTC (no active NBA/MLB/NHL slates) |
| Discord notice | Post in ops channel ≥24h before cutover |
| Pick distribution | Must be quiesced — no picks pending in outbox at freeze start |

---

## 2. Phase 1 — Freeze and final sync (T−60 min to T+0)

### 2.1 Quiesce writes to Supabase

```bash
# Stop all services writing to Supabase
# Order matters: ingestor first, then scanner, then worker, then API
systemctl stop unit-talk-ingestor
systemctl stop unit-talk-scanner
systemctl stop unit-talk-worker
systemctl stop unit-talk-api

# Verify outbox is drained (0 rows with status='pending')
psql $SUPABASE_DATABASE_URL -c "SELECT count(*) FROM outbox WHERE status='pending';"
# Must return 0 before proceeding
```

### 2.2 Final logical dump from Supabase

```bash
# App DB dump (unit_talk_app schema)
pg_dump \
  --no-password \
  --format=custom \
  --no-owner \
  --no-acl \
  --schema=public \
  "$SUPABASE_DATABASE_URL" \
  --file="/tmp/unit-talk-app-$(date +%Y%m%dT%H%M%S).dump"

# Record dump SHA
sha256sum /tmp/unit-talk-app-*.dump > /tmp/unit-talk-app-dump.sha256
```

### 2.3 Record Supabase freeze state

```bash
psql $SUPABASE_DATABASE_URL <<EOF
SELECT
  (SELECT count(*) FROM picks)            AS picks,
  (SELECT count(*) FROM approved_picks)   AS approved_picks,
  (SELECT count(*) FROM outbox)           AS outbox,
  (SELECT count(*) FROM receipts)         AS receipts,
  (SELECT count(*) FROM settlements)      AS settlements,
  (SELECT count(*) FROM pick_grades)      AS pick_grades,
  now()                                   AS freeze_at;
EOF
```

Save this output — it is the freeze state baseline for post-cutover verification.

---

## 3. Phase 2 — Import to Hetzner (T+0 to T+60 min)

### 3.1 Restore dump to Hetzner app DB

```bash
# Copy dump to Hetzner DB server (or stream directly)
pg_restore \
  --no-password \
  --no-owner \
  --no-acl \
  --format=custom \
  --dbname="$HETZNER_DATABASE_URL" \
  /tmp/unit-talk-app-*.dump

echo "Restore exit code: $?"
```

### 3.2 Verify row counts match freeze state

```bash
psql $HETZNER_DATABASE_URL <<EOF
SELECT
  (SELECT count(*) FROM picks)            AS picks,
  (SELECT count(*) FROM approved_picks)   AS approved_picks,
  (SELECT count(*) FROM outbox)           AS outbox,
  (SELECT count(*) FROM receipts)         AS receipts,
  (SELECT count(*) FROM settlements)      AS settlements,
  (SELECT count(*) FROM pick_grades)      AS pick_grades;
EOF
```

Row counts must match the freeze state recorded in §2.3. Any discrepancy → rollback.

### 3.3 Run Supabase vs Hetzner comparison

```bash
pnpm db:compare
# Must report 0 mismatches on row counts, status distributions
# Freshness mismatch on ingestion tables is expected and acceptable
```

---

## 4. Phase 3 — Environment switch (T+60 to T+90 min)

Switch each service to point at Hetzner **one at a time**, verify, then proceed.

### 4.1 API

```bash
# Update DATABASE_URL in Hetzner secrets file
# Restart API
systemctl restart unit-talk-api

# Smoke check
curl -sf http://localhost:3000/health | jq .
# Must return { "status": "ok" }
```

### 4.2 Ingestor

```bash
systemctl restart unit-talk-ingestor
# Wait 2 minutes, then check provider_offer_current freshness
psql $HETZNER_DATABASE_URL -c \
  "SELECT max(snapshot_at), now() - max(snapshot_at) AS age FROM provider_offers;"
# Age must be < 5 minutes within 10 minutes of ingestor restart
```

### 4.3 Scanner

```bash
systemctl restart unit-talk-scanner
# Verify scan cycle completes without errors
journalctl -u unit-talk-scanner --since "1 minute ago" | grep -E "scan complete|ERROR"
```

### 4.4 Worker

```bash
systemctl restart unit-talk-worker
# Verify outbox draining resumes
psql $HETZNER_DATABASE_URL -c \
  "SELECT status, count(*) FROM outbox GROUP BY status;"
```

### 4.5 Discord bot

```bash
systemctl restart unit-talk-discord-bot
# Verify bot is online in Discord ops channel
```

### 4.6 Ops Bot

```bash
systemctl restart unit-talk-ops-bot
```

---

## 5. Phase 4 — DNS switch (T+90 min, if applicable)

If any public-facing endpoints use DNS records pointing at Supabase-backed services, update them now. This applies only if the API or Smart Form is accessed via a custom domain.

```bash
# Update DNS A/CNAME records to point at Hetzner CCX23 IP
# TTL must have been lowered to ≤60s at least 1 hour before cutover
```

---

## 6. Smoke checks (T+90 to T+120 min)

Run all checks. Any failure triggers the rollback threshold assessment in §7.

| Check | Command / Verification | Expected |
|-------|----------------------|----------|
| API health | `curl /health` | `{ "status": "ok" }` |
| Ingestor freshness | `max(snapshot_at)` age | < 5 minutes |
| Scanner cycle | journalctl | No ERROR lines |
| Outbox draining | `outbox` status counts | `pending` → 0 over time |
| Pick submission | Submit a test pick via Smart Form | Appears in `picks` table |
| Receipt delivery | Test pick receipt | `receipts` row created |
| Discord bot | Send `/status` command | Bot responds |
| Ops Bot | Check ops channel | Health report appears |
| Backup job | WAL archiving to BX11 | Archive dir updated |
| Comparison | `pnpm db:compare` | 0 mismatches |

---

## 7. Rollback triggers

**Rollback immediately (no threshold assessment):**
- API health check fails after restart
- Row count mismatch between Supabase freeze state and Hetzner (§3.2)
- Outbox delivers to wrong recipients
- Pick submission fails at API layer

**Assess before rollback (15-minute observation window):**
- Ingestor freshness > 5 minutes after 10 minutes
- Scanner producing errors but picks still flowing
- Discord bot offline but other services healthy

**Rollback procedure:**
1. Stop all Hetzner services
2. Repoint env vars to Supabase DATABASE_URL
3. Restart all services against Supabase
4. Verify API health and outbox resume
5. Post incident note in ops channel
6. Do not retry cutover without root cause analysis

---

## 8. Post-cutover (T+120 min onward)

- [ ] Supabase project set to read-only or paused (do not delete for 30 days)
- [ ] Update `local.env` and GitHub Actions secrets to Hetzner URLs
- [ ] Run `pnpm db:disk-report` to establish Hetzner disk baseline
- [ ] Confirm backup job ran and BX11 + off-site backup received
- [ ] Update `HETZNER_SCOPE_LOCK_V1.md` with cutover date
- [ ] Close UTV2-770 parent issue

---

## 9. PM cutover authorisation

**To be filled before any production cutover attempt:**

| Field | Value |
|-------|-------|
| PM sign-off | _pending_ |
| Date authorised | _pending_ |
| Maintenance window | _pending_ |
| Rehearsal run date | _pending_ |
| Comparison run SHA | _pending_ |
