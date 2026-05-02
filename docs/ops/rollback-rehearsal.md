# UTV2-784 Rollback Rehearsal Runbook

This runbook rehearses rollback from the Hetzner PostgreSQL cutover target back to Supabase for the Unit Talk V2 migration.

## 1. Cutover Decision Gate

### Rollback authority

Only one of the following roles may call rollback during the rehearsal or production cutover:

1. Incident commander assigned to the migration window.
2. Database owner assigned to the migration window.
3. Engineering lead on call, if the incident commander cannot be reached within 5 minutes.

The rollback caller must state the decision in the migration bridge and record it in the rehearsal log.

### Observable rollback triggers

Call rollback when any one of these conditions is observed during the decision window:

1. API write error rate is greater than 2% for 5 consecutive minutes.
   ```powershell
   pnpm ops:runtime-health
   ```
   Roll back if the API health output reports `write_error_rate_percent` greater than `2`.

2. P95 API write latency is greater than 1500 ms for 5 consecutive minutes.
   ```powershell
   pnpm ops:runtime-health
   ```
   Roll back if the API health output reports `api_write_p95_ms` greater than `1500`.

3. Worker outbox delivery failures exceed 3 failed rows in the cutover window.
   ```sql
   select status, count(*) as rows
   from distribution_outbox
   where created_at >= :'cutover_start_utc'
   group by status
   order by status;
   ```
   Roll back if `status = 'failed'` returns more than `3`.

4. Data integrity checks find missing lifecycle, audit, settlement, or promotion rows.
   ```sql
   select p.id
   from picks p
   left join pick_lifecycle l on l.pick_id = p.id
   where p.created_at >= :'cutover_start_utc'
     and l.id is null;
   ```
   Roll back if the query returns any row.

5. Discord bot cannot post to `discord:canary` or `discord:best-bets` after two restart attempts.
   ```powershell
   pnpm ops:discord-health
   ```
   Roll back if either live channel reports `unhealthy`.

### Decision window duration

1. Start the decision window when DNS or application config first points production writes at Hetzner.
2. Hold a 30-minute decision window.
3. Review the trigger checks at minute 5, 10, 15, 20, 25, and 30.
4. If a rollback trigger fires, call rollback immediately. Do not wait for the full 30 minutes.
5. If no trigger fires by minute 30, record `rollback not triggered` in the rehearsal log and continue validation.

## 2. Write-Freeze Procedure

Use this procedure before rollback and before any rehearsal cutover that could produce split writes.

1. Announce the write freeze in the migration bridge.
   ```text
   Write freeze starting at <UTC timestamp>. API writes, worker delivery, and provider ingestion are being paused.
   ```

2. Disable inbound API write routes by setting runtime write mode to closed in `local.env` or the production secrets manager.
   ```powershell
   $env:UNIT_TALK_WRITE_MODE = "closed"
   pnpm ops:restart-api
   ```

3. Confirm API writes are rejected with the expected maintenance response.
   ```powershell
   Invoke-WebRequest -Method POST `
     -Uri "https://api.unit-talk.example/api/submissions" `
     -ContentType "application/json" `
     -Body "{}"
   ```
   Continue only when the response status is `503` and the body identifies write freeze or maintenance mode.

4. Pause the outbox worker.
   ```powershell
   $env:UNIT_TALK_WORKER_ENABLED = "false"
   pnpm ops:restart-worker
   ```

5. Confirm the worker is paused.
   ```powershell
   pnpm ops:worker-health
   ```
   Continue only when the output reports `worker_enabled=false` and no active claim is running.

6. Pause provider ingestion and scheduled polling.
   ```powershell
   $env:UNIT_TALK_INGESTOR_ENABLED = "false"
   pnpm ops:restart-ingestor
   ```

7. Confirm `distribution_outbox` queue depth is zero.
   ```sql
   select status, count(*) as rows
   from distribution_outbox
   where status in ('pending', 'claimed', 'retry')
   group by status
   order by status;
   ```
   Continue only when the query returns no rows. If rows remain, wait 60 seconds, rerun the query, and escalate to the database owner if the count does not decrease.

8. Confirm there are no unposted picks created during the freeze.
   ```sql
   select status, count(*) as rows
   from picks
   where created_at >= :'freeze_start_utc'
   group by status
   order by status;
   ```
   Continue only when no new `validated` or `queued` rows appear after the freeze timestamp.

9. Take a final WAL checkpoint on the active write database.
   ```sql
   checkpoint;
   select pg_current_wal_lsn() as final_wal_lsn, now() as checkpoint_at;
   ```
   Record `final_wal_lsn` and `checkpoint_at` in the rehearsal log.

## 3. Rollback Steps per System

### DNS

1. Set DNS TTL to 60 seconds at least 30 minutes before the rehearsal window. If the current TTL is higher, wait for the previous TTL to expire before cutover.
2. Revert the API A/CNAME records from Hetzner back to the Supabase-backed production endpoint.
   ```powershell
   # Example with Cloudflare CLI. Replace zone and record IDs with production values.
   cloudflare-cli dns update `
     --zone unit-talk.example `
     --record api.unit-talk.example `
     --type CNAME `
     --content supabase-api.unit-talk.example `
     --ttl 60
   ```
3. Confirm public DNS resolves to the Supabase-backed target.
   ```powershell
   Resolve-DnsName api.unit-talk.example -Type CNAME
   Resolve-DnsName api.unit-talk.example -Type A
   ```
4. Confirm the API health endpoint responds through the reverted DNS path.
   ```powershell
   Invoke-RestMethod https://api.unit-talk.example/health
   ```

### Environment config

1. In `local.env` for local rehearsal, or the production secrets manager for hosted runtime, swap database and Supabase variables back to Supabase values:
   ```text
   DATABASE_URL=<supabase-postgres-connection-string>
   SUPABASE_URL=<supabase-project-url>
   SUPABASE_SERVICE_ROLE_KEY=<supabase-service-role-key>
   SUPABASE_ANON_KEY=<supabase-anon-key>
   UNIT_TALK_DB_PROVIDER=supabase
   ```
2. Remove or disable Hetzner-only values for the rollback window:
   ```text
   HETZNER_DATABASE_URL=
   UNIT_TALK_DB_PROVIDER=hetzner
   ```
3. Restart services in this order so readers and writers use the same database target:
   ```powershell
   pnpm ops:restart-api
   pnpm ops:restart-worker
   pnpm ops:restart-discord-bot
   pnpm ops:restart-ingestor
   ```
4. Confirm each service reports the Supabase database provider.
   ```powershell
   pnpm ops:runtime-health
   ```
   Continue only when API, worker, Discord bot, and ingestor all report `db_provider=supabase`.

### Discord bot

1. Re-point the bot process to the Supabase connection string in `local.env` or the production secrets manager:
   ```text
   DATABASE_URL=<supabase-postgres-connection-string>
   SUPABASE_URL=<supabase-project-url>
   ```
2. Restart the bot.
   ```powershell
   pnpm ops:restart-discord-bot
   ```
3. Confirm bot process health.
   ```powershell
   pnpm ops:discord-health
   ```
4. Send a canary health message only to the live canary target.
   ```powershell
   pnpm ops:discord-canary --channel discord:canary --message "UTV2-784 rollback rehearsal health check"
   ```
5. Confirm `discord:canary` and `discord:best-bets` are healthy. Do not activate blocked targets.

### SGO / provider APIs

1. Check whether any provider callback URL was changed for Hetzner.
   ```powershell
   pnpm ops:provider-callbacks
   ```
2. If callbacks exist, set each callback URL back to the Supabase-backed API endpoint in the provider dashboard:
   ```text
   https://api.unit-talk.example/api/provider-callbacks/<provider>
   ```
3. Re-enable provider feed polling against the Supabase endpoint.
   ```powershell
   $env:UNIT_TALK_INGESTOR_ENABLED = "true"
   $env:DATABASE_URL = "<supabase-postgres-connection-string>"
   pnpm ops:restart-ingestor
   ```
4. Confirm provider polling resumes without creating write errors.
   ```powershell
   pnpm ops:provider-health
   pnpm ops:runtime-health
   ```

## 4. Data Divergence Detection

Run these checks after rollback and before declaring the database clean.

1. Record the cutover window.
   ```text
   cutover_start_utc=<UTC timestamp when writes first pointed to Hetzner>
   rollback_complete_utc=<UTC timestamp when all services pointed back to Supabase>
   ```

2. On Hetzner, find rows written only during the cutover window.
   ```sql
   select 'picks' as table_name, id, created_at, updated_at
   from picks
   where created_at >= :'cutover_start_utc'
     and created_at <= :'rollback_complete_utc'
   union all
   select 'distribution_outbox' as table_name, id, created_at, updated_at
   from distribution_outbox
   where created_at >= :'cutover_start_utc'
     and created_at <= :'rollback_complete_utc'
   union all
   select 'settlement_records' as table_name, id, created_at, updated_at
   from settlement_records
   where created_at >= :'cutover_start_utc'
     and created_at <= :'rollback_complete_utc'
   union all
   select 'pick_promotion_history' as table_name, id, created_at, updated_at
   from pick_promotion_history
   where created_at >= :'cutover_start_utc'
     and created_at <= :'rollback_complete_utc'
   order by table_name, created_at;
   ```

3. Compare Hetzner rows to Supabase by primary key.
   ```sql
   -- Run against Hetzner with postgres_fdw, dblink, or an exported Supabase snapshot table.
   select h.id, h.created_at
   from picks h
   left join supabase_compare.picks s on s.id = h.id
   where h.created_at >= :'cutover_start_utc'
     and h.created_at <= :'rollback_complete_utc'
     and s.id is null;
   ```

4. Count divergence by table.
   ```sql
   select table_name, count(*) as diverged_rows
   from rollback_divergence_candidates
   group by table_name
   order by table_name;
   ```

5. Choose the reconciliation strategy:
   - Write-back: use when rows represent accepted customer or operator actions that must survive rollback.
   - Accept loss: use only when rows are test records, duplicate provider pulls, failed transient outbox attempts, or otherwise approved for discard by the incident commander and database owner.

6. For write-back, insert missing rows into Supabase in dependency order: `picks`, `pick_lifecycle`, `pick_promotion_history`, `distribution_outbox`, `distribution_receipts`, `settlement_records`, `audit_log`.
   ```powershell
   psql $env:SUPABASE_DATABASE_URL -f .\tmp\rollback-writeback.sql
   ```

7. For accepted loss, export the diverged rows before discard.
   ```powershell
   psql $env:HETZNER_DATABASE_URL -c "\copy (select * from rollback_divergence_candidates) to 'tmp/UTV2-784-divergence.csv' csv header"
   ```

8. Sign-off required before declaring data clean:
   - Incident commander signs the reconciliation action.
   - Database owner signs that Supabase contains the intended final state.
   - Product or operations owner signs any accepted data loss.

## 5. Supabase Read-Only Posture

Use this posture after the Hetzner cutover succeeds, while keeping Supabase warm for fast rollback during the validation window.

1. Keep Supabase running and reachable from the operations network.
2. Revoke application write grants from the Supabase app role.
   ```sql
   revoke insert, update, delete on all tables in schema public from authenticated;
   revoke insert, update, delete on all tables in schema public from service_role;
   ```
3. Force default transaction read-only for the application role when the role supports it.
   ```sql
   alter role unit_talk_app set default_transaction_read_only = on;
   ```
4. Confirm Supabase rejects writes and allows reads.
   ```sql
   begin;
   insert into audit_log(entity_type, entity_id, entity_ref, action, metadata)
   values ('rollback_rehearsal', gen_random_uuid(), 'UTV2-784', 'read_only_probe', '{}'::jsonb);
   rollback;
   ```
   Continue only when the insert fails with a read-only or permission error.

5. Keep the Supabase connection strings and secrets available in the rollback secret set:
   ```text
   DATABASE_URL
   SUPABASE_URL
   SUPABASE_SERVICE_ROLE_KEY
   SUPABASE_ANON_KEY
   ```

6. During the validation window, run read checks every 15 minutes.
   ```powershell
   pnpm ops:supabase-read-health
   ```

7. End read-only posture only after the validation window passes and the production cutover owner approves decommissioning.
8. Decommission Supabase by exporting a final backup, disabling runtime secrets, and recording the decommission timestamp.
   ```powershell
   supabase db dump --project-ref feownrheeefbcsehtsiw --file backups/supabase-final-UTV2-784.sql
   ```

## 6. Rehearsal Log Template

| Field | Value |
| --- | --- |
| Rehearsal date |  |
| Operator |  |
| Cutover-start time |  |
| Rollback-trigger time |  |
| Rollback-complete time |  |
| Data rows diverged |  |
| Reconciliation action |  |
| Pass/fail verdict |  |
| Open issues |  |

## 7. Post-Rehearsal Sign-Off Checklist

1. [ ] Rollback authority and decision window were recorded in the rehearsal log.
2. [ ] API write routes returned the expected write-freeze response before rollback steps began.
3. [ ] Outbox worker was paused and `distribution_outbox` pending depth was zero.
4. [ ] Final WAL checkpoint LSN and timestamp were recorded.
5. [ ] DNS, environment config, Discord bot, and provider polling were reverted to Supabase and health-checked with commands in this runbook.
6. [ ] Data divergence query results were captured for every table listed in Section 4.
7. [ ] Reconciliation action was completed or accepted loss was signed by the incident commander, database owner, and product or operations owner.
8. [ ] Supabase read-only posture was tested with a failed write probe.
9. [ ] Rehearsal log contains rollback-trigger time, rollback-complete time, pass/fail verdict, and open issues.
10. [ ] Incident commander declared the team cleared or not cleared for production cutover.
