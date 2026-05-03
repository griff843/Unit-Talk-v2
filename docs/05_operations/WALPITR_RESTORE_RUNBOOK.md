# WAL/PITR Backup Restore Runbook — UTV2-782

**Authority:** This runbook is the execution guide for UTV2-782. Follow it to satisfy all acceptance criteria. After each step, capture the exact command output in the proof artifact.

**Targets:**
- App DB RPO ≤ 15 minutes
- MVP RTO ≤ 2 hours
- Restore verified against: lifecycle, outbox, receipts, picks, provider_offers

---

## Prerequisites

- Hetzner Storage Box provisioned (SFTP/rsync access credentials available)
- Second backup provider credentials available (e.g., Backblaze B2, or a second Hetzner Storage Box in a different location)
- Supabase service role key available for the heartbeat write
- An isolated Postgres instance available for the restore test (a second VM or container, not production)
- `pg_basebackup`, `pg_restore`, or WAL-G installed on the Hetzner host

---

## Step 1: Enable WAL Archiving on the App DB

Edit `/etc/postgresql/<version>/main/postgresql.conf` (or the Postgres config for your Hetzner instance):

```conf
wal_level = replica
archive_mode = on
archive_command = 'test ! -f /mnt/storage-box/wal/%f && cp %p /mnt/storage-box/wal/%f'
archive_timeout = 300   # archive at least every 5 minutes (supports RPO ≤ 15m)
```

Reload Postgres:

```bash
sudo systemctl reload postgresql
```

Verify archiving is working. Check the archive destination has WAL segment files:

```bash
ls -lh /mnt/storage-box/wal/ | tail -5
```

Expected: WAL segment files (named like `000000010000000000000001`) appearing every few minutes.

**Proof capture:** paste `ls -lh /mnt/storage-box/wal/ | tail -5` output into the proof doc.

---

## Step 2: Configure Daily Basebackup to Storage Box

Create the backup script at `/usr/local/bin/ut-backup-daily.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="/mnt/storage-box/basebackup"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_PATH="$BACKUP_DIR/$TIMESTAMP"

mkdir -p "$BACKUP_PATH"

# Take basebackup (adjust --pgdata if needed for your Postgres version)
pg_basebackup \
  --pgdata="$BACKUP_PATH" \
  --format=tar \
  --gzip \
  --checkpoint=fast \
  --wal-method=stream \
  --progress \
  --verbose 2>&1 | tee "$BACKUP_PATH.log"

# Write heartbeat to monitoring DB
PGPASSWORD="$SUPABASE_SERVICE_ROLE_KEY" psql "$SUPABASE_URL" <<SQL
INSERT INTO system_runs (run_type, status, started_at, finished_at, details)
VALUES (
  'backup.daily',
  'succeeded',
  now() - interval '5 minutes',
  now(),
  jsonb_build_object('target', 'storage-box', 'path', '$BACKUP_PATH', 'timestamp', '$TIMESTAMP')
)
ON CONFLICT DO NOTHING;
SQL

echo "[ut-backup] Backup complete: $BACKUP_PATH"
```

Make it executable:

```bash
chmod +x /usr/local/bin/ut-backup-daily.sh
```

Add to cron (runs at 02:00 daily):

```bash
crontab -e
# Add:
0 2 * * * SUPABASE_URL=<your-url> SUPABASE_SERVICE_ROLE_KEY=<your-key> /usr/local/bin/ut-backup-daily.sh >> /var/log/ut-backup.log 2>&1
```

Run once manually to verify:

```bash
sudo -u postgres /usr/local/bin/ut-backup-daily.sh
```

**Proof capture:** paste the backup log output showing completion.

---

## Step 3: Configure Second-Provider Backup Copy

Sync the Storage Box backup to a second location immediately after the daily backup:

```bash
# Append to ut-backup-daily.sh, after the pg_basebackup block:

# Sync to second provider (e.g., rclone to Backblaze B2)
rclone sync /mnt/storage-box/basebackup b2:unit-talk-backups/basebackup \
  --log-level INFO \
  --transfers 4 2>&1 | tee -a "$BACKUP_PATH.log"

echo "[ut-backup] Off-site sync complete"
```

If using a second Hetzner Storage Box:

```bash
rsync -avz --delete /mnt/storage-box/basebackup/ /mnt/storage-box-2/basebackup/
```

**Proof capture:** paste the sync command output confirming files transferred.

---

## Step 4: Add Backup Alert Script to Monitoring Cron

Deploy `scripts/backup-alert-check.ts` (shipped in this PR) as a cron job on the monitoring host:

```bash
# Runs every 30 minutes — alerts if no backup.daily heartbeat in 25h
*/30 * * * * cd /opt/unit-talk && source local.env && npx tsx scripts/backup-alert-check.ts >> /var/log/ut-backup-alert.log 2>&1
```

Or with explicit threshold for tighter monitoring:

```bash
*/30 * * * * cd /opt/unit-talk && BACKUP_ALERT_THRESHOLD_HOURS=26 source local.env && npx tsx scripts/backup-alert-check.ts >> /var/log/ut-backup-alert.log 2>&1
```

Test the alert script manually:

```bash
source local.env && npx tsx scripts/backup-alert-check.ts
```

Expected output: JSON line with `"level":"OK"` if backup.daily heartbeat is present and fresh.

**Proof capture:** paste the script output.

---

## Step 5: Run Isolated Restore Test

Provision an isolated Postgres instance (separate VM or container — not production).

### 5a. Copy backup to restore host

```bash
rsync -avz /mnt/storage-box/basebackup/<latest-timestamp>/ restore-host:/var/lib/postgresql/restore/
```

### 5b. Configure recovery on the restore host

Create `/var/lib/postgresql/restore/recovery.signal` (PostgreSQL 12+):

```bash
touch /var/lib/postgresql/restore/recovery.signal
```

Edit `/var/lib/postgresql/restore/postgresql.conf`:

```conf
restore_command = 'cp /mnt/storage-box/wal/%f %p'
recovery_target_time = '<ISO timestamp within 15 min of latest WAL>'
recovery_target_action = 'promote'
port = 5433   # use a non-conflicting port
```

### 5c. Start isolated Postgres and wait for recovery

```bash
sudo -u postgres pg_ctl start -D /var/lib/postgresql/restore/ -l /tmp/restore.log
tail -f /tmp/restore.log
```

Wait for: `LOG: database system is ready to accept read only connections` followed by `LOG: selected new timeline ID`.

### 5d. Record recovery time (RTO measurement)

Start a timer when you begin the restore (Step 5a) and stop it when Postgres is ready (end of 5c). This is your measured RTO.

---

## Step 6: Verify Critical Tables Post-Restore

Connect to the isolated instance:

```bash
psql -h localhost -p 5433 -U postgres
```

Run each verification query and capture the output:

```sql
-- Lifecycle / picks table
SELECT count(*), max(created_at) FROM picks;

-- Outbox
SELECT count(*), max(created_at) FROM distribution_outbox;

-- Receipts
SELECT count(*), max(recorded_at) FROM distribution_receipts;

-- Provider offers (ingestion freshness)
SELECT count(*), max(snapshot_at) FROM provider_offers;

-- Lifecycle FSM state check
SELECT lifecycle_state, count(*) FROM picks GROUP BY lifecycle_state ORDER BY 2 DESC LIMIT 10;
```

**RPO measurement:** compare `max(snapshot_at)` from `provider_offers` and `max(created_at)` from `picks` against the current production timestamps. The gap is your measured RPO.

**Proof capture:** paste all query outputs into the proof doc. Include the restore host timestamp so the RPO gap is verifiable.

---

## Step 7: Record RPO/RTO Results

| Metric | Target | Measured |
|---|---|---|
| App DB RPO | ≤ 15 minutes | `<fill in>` |
| MVP RTO | ≤ 2 hours | `<fill in>` |

If either target is not met, document what must change (e.g., more frequent WAL archiving, faster network to Storage Box) before marking AC complete.

---

## Proof Capture Template

After completing all steps, create `docs/06_status/proof/UTV2-782.md` using the following structure:

```
# PROOF: UTV2-782
MERGE_SHA: <merge SHA from main after this PR merges>

ASSERTIONS:
- [x] WAL archiving enabled — archive_mode=on, archive_timeout=300s, WAL files confirmed in storage-box
- [x] Daily basebackup to Storage Box configured — cron job running, last run: <timestamp>
- [x] Second-provider backup copy configured — rclone/rsync to <provider> confirmed
- [x] Restore into isolated Postgres succeeded — recovery.signal + WAL replay, promoted in <N> minutes
- [x] Critical tables verified post-restore — picks, outbox, receipts, provider_offers row counts match
- [x] RPO <Xm> (target ≤15m), RTO <Yh Zm> (target ≤2h)
- [x] backup-alert-check.ts deployed to cron, tested — outputs OK with fresh heartbeat

EVIDENCE:
WAL archive listing:
<paste ls -lh output>

Basebackup log tail:
<paste backup completion lines>

Off-site sync output:
<paste rsync/rclone completion>

Restore log (recovery complete line):
<paste LOG lines from restore.log>

Table verification queries:
<paste psql output for each table>

RPO/RTO measurements:
  RPO: production max(snapshot_at)=<X> vs restore max(snapshot_at)=<Y>, gap=<N>m
  RTO: restore started <HH:MM> → Postgres ready <HH:MM> = <N>m total

Backup alert check output:
<paste: npx tsx scripts/backup-alert-check.ts output>
```
