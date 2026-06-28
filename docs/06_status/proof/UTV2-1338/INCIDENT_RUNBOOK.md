# Incident Runbook — Unit Talk V2

**Issue:** UTV2-1338  
**Status:** Active operational reference  
**Owner:** PM (A Griffin)  
**Last updated:** 2026-06-28  

This runbook covers the six highest-frequency incident classes observed in Unit Talk V2 production. Each section includes detection signals, diagnosis steps, recovery commands, and a verification gate. Base all diagnosis on real artifacts (logs, DB queries, system_runs) — never on narrative claims.

---

## Table of Contents

1. [Ingestor Not Cycling](#1-ingestor-not-cycling)
2. [DB Timeout (statement_timeout / Supabase)](#2-db-timeout)
3. [Settlement / Grading Failure](#3-settlement--grading-failure)
4. [Deploy Failure](#4-deploy-failure)
5. [Provider Key / API Issue (SGO)](#5-provider-key--api-issue-sgo)
6. [Supabase Degraded](#6-supabase-degraded)

---

## 1. Ingestor Not Cycling

### Context

The ingestor is a resident daemon (`UNIT_TALK_INGESTOR_MAX_CYCLES=0`) that polls SGO per league on a peak/off-peak schedule (30 s peak, 300 s off-peak). A watchdog timer fires if no loop progress is recorded within 20 minutes and forces a container exit so the `restart: unless-stopped` policy restarts it. Previous failures: UTV2-1284 (watchdog false-positive on slow MLB cycle), UTV2-1286 (watchdog fix), UTV2-1293 (MAX_CYCLES=1 daemon-resident fix).

### Detection

| Signal | How to check |
|--------|-------------|
| No new rows in `provider_offer_history` for > 30 min | `SELECT max(snapshot_at) FROM provider_offer_history;` — stale = ingestor wedged |
| `system_runs` shows no recent `ingestor.cycle` run | `SELECT * FROM system_runs WHERE run_type='ingestor.cycle' ORDER BY created_at DESC LIMIT 5;` |
| Host process check | `ssh $DEPLOY_USER@$DEPLOY_HOST "docker ps | grep ingestor"` — confirm container is Running |
| Alert script | `npx tsx scripts/ingestor-alert-check.ts` |

A stale `max(snapshot_at)` older than 35 minutes during an expected active window confirms the ingestor is not cycling.

### Diagnosis

1. Check container status and recent logs:
   ```bash
   ssh $DEPLOY_USER@$DEPLOY_HOST "cd $DEPLOY_PATH && docker compose logs --tail=100 ingestor"
   ```
2. Look for: `watchdog: no loop progress`, `exit code 1`, `statement_timeout`, `SGO key`, `ECONNREFUSED`.
3. Check `system_runs` for stale open runs (orphaned from a crash):
   ```sql
   SELECT id, run_type, status, created_at FROM system_runs
   WHERE run_type = 'ingestor.cycle' AND status = 'running'
   ORDER BY created_at DESC LIMIT 10;
   ```
4. Check Supabase DB health (see §6) — ingestor cycle failures often co-present with DB degradation.
5. Verify SGO key is valid:
   ```bash
   npx tsx scripts/sgo-key-status.ts
   ```

### Recovery

**Restart the container (most common fix):**
```bash
ssh $DEPLOY_USER@$DEPLOY_HOST "cd $DEPLOY_PATH && docker compose restart ingestor"
```

**If orphaned `ingestor.cycle` runs are blocking startup**, the ingestor's `reapStaleRuns` routine handles this automatically on startup — allow the restart to complete before intervening.

**If the issue is a DB timeout** (statement_timeout in logs), follow §2 first, then restart ingestor.

**If the SGO key is expired/invalid**, follow §5 first, then restart.

**If `MAX_CYCLES` is misconfigured** (set to 1 instead of 0), the container will exit cleanly after one cycle and restart in a churn loop. Fix in `.env.production`:
```
UNIT_TALK_INGESTOR_MAX_CYCLES=0
```
Then redeploy or restart.

### Verification

```bash
# Confirm cycling resumed
ssh $DEPLOY_USER@$DEPLOY_HOST "cd $DEPLOY_PATH && docker compose logs --tail=20 ingestor"
# Look for: "ingestor cycle complete", league names, no error exits

# Confirm new rows are being written
# Run in Supabase SQL editor:
SELECT max(snapshot_at), count(*) FROM provider_offer_history
WHERE snapshot_at > NOW() - INTERVAL '10 minutes';
# Expected: count > 0, snapshot_at recent
```

Recovery is confirmed when `max(snapshot_at)` advances within the expected polling interval.

---

## 2. DB Timeout

### Context

Unit Talk uses Supabase (Postgres) with a `statement_timeout` on all connections. Large scans on unpartitioned or under-indexed tables can hit this timeout. Known triggers: `provider_offer_history` without `snapshot_at` lower-bound (60 partitions, 1.39M+ rows — fixed in UTV2-1315), `system_runs` bloat (UTV2-1290/1292). Supabase also enforces its own platform-level rate limits and connection pool saturation.

### Detection

| Signal | How to check |
|--------|-------------|
| `statement_timeout` in container logs | `docker compose logs --tail=200 api \| grep -i timeout` |
| PostgREST 503 responses | `curl -s http://localhost:4000/health` returning non-200 |
| `system_runs` entries with `status='failed'` and `details.error` containing timeout | See query below |
| Supabase Dashboard alerts | Supabase project `zfzdnfwdarxucxtaojxm` → Logs → Postgres |

```sql
-- Find recent timeout failures
SELECT run_type, created_at, details
FROM system_runs
WHERE status = 'failed'
  AND details::text ILIKE '%timeout%'
ORDER BY created_at DESC LIMIT 20;
```

### Diagnosis

1. Identify which query is timing out from logs — look for the table name and query type.
2. Check table sizes:
   ```sql
   SELECT relname, pg_size_pretty(pg_total_relation_size(oid)) as total_size
   FROM pg_class
   WHERE relname IN ('system_runs','provider_offer_history','picks','settlements')
   ORDER BY pg_total_relation_size(oid) DESC;
   ```
3. Check for table bloat (dead rows):
   ```sql
   SELECT relname, n_dead_tup, last_autovacuum
   FROM pg_stat_user_tables
   WHERE relname IN ('system_runs','provider_offer_history')
   ORDER BY n_dead_tup DESC;
   ```
4. Check for missing lower-bound on `provider_offer_history` queries (partition pruning is required — the fix in UTV2-1315 adds `snapshot_at >=` lower-bound to `markClosingLines`).

### Recovery

**For `system_runs` bloat:**
```sql
-- PM approval required before running VACUUM on a production table
VACUUM ANALYZE system_runs;
-- If autovacuum is falling behind, check autovacuum settings
SELECT * FROM pg_stat_user_tables WHERE relname = 'system_runs';
```

**For `provider_offer_history` timeouts (partition scan):**
- Ensure the query path uses a `snapshot_at >=` lower-bound filter. Without it, the planner scans all 60 partitions.
- The production fix (UTV2-1315) patched `markClosingLines` — confirm the deployed version includes this fix.

**For Supabase platform saturation:**
- Reduce ingestor polling frequency temporarily: set `UNIT_TALK_INGESTOR_PEAK_POLL_MS=60000` and restart ingestor.
- Wait for Supabase to recover. Platform-level incidents are visible at `status.supabase.com`.

**For connection pool exhaustion:**
- Restart services to release idle connections: `docker compose restart api worker`.

### Verification

```bash
# Confirm no recent timeouts in last 5 minutes
docker compose logs --tail=50 api | grep -i timeout
# Expected: no output

# Confirm system_runs writing cleanly
# In Supabase SQL:
SELECT count(*), max(created_at) FROM system_runs
WHERE created_at > NOW() - INTERVAL '5 minutes';
```

---

## 3. Settlement / Grading Failure

### Context

Settlement is driven by `grading-service.ts` (`runGradingPass`). It fetches picks in `posted` and `awaiting_approval` lifecycle states, looks up game results, and records settlements via `recordGradedSettlement` / `recordEvidenceSettlement`. Grading runs are tracked in `system_runs` with `run_type='grading.run'`. The service uses `atomicClaimForTransition` to prevent double-settlement. Picks are skipped (not errored) for valid reasons: `event_not_completed`, `game_result_not_found`, `settlement_already_exists`, `event_provenance_untrusted_provider`.

Grading only trusts SGO-provenance events (`TRUSTED_GRADING_EVENT_PROVIDERS = new Set(['sgo'])`). Events missing `ingestionCycleRunId` or `ingestionSource !== 'ingestor.cycle'` are rejected.

### Detection

| Signal | How to check |
|--------|-------------|
| `system_runs` shows `grading.run` failures | See query below |
| Picks stuck in `posted` for > 24h after event completion | See query below |
| Error in API logs | `docker compose logs api | grep -i "grading failed"` |
| Alert script | `npx tsx scripts/grading-alert-check.ts` |

```sql
-- Recent grading run failures
SELECT id, status, created_at, details
FROM system_runs
WHERE run_type = 'grading.run'
ORDER BY created_at DESC LIMIT 10;

-- Picks stuck in posted state after their event date
SELECT id, market, selection, created_at, status
FROM picks
WHERE status = 'posted'
  AND created_at < NOW() - INTERVAL '48 hours'
ORDER BY created_at ASC LIMIT 20;
```

### Diagnosis

1. Check recent `grading.run` details — the `details` JSON contains `{ picksGraded, failed }`.
2. Check API logs for per-pick error messages:
   ```bash
   docker compose logs api | grep "Grading failed for pick"
   ```
3. Common skip reasons (not errors — these are expected):
   - `event_not_completed` — event status is not `completed` in DB yet; wait for ingestor to update
   - `game_result_not_found` — SGO result not yet available; retried with 15-min backoff (up to 3 attempts)
   - `event_provenance_untrusted_provider` — event was ingested without SGO provenance (check ingestor health)
   - `event_provenance_missing_ingestion_cycle` — event metadata is missing `ingestionCycleRunId` (ingestor bug)
   - `missing_participant_id` — player/team not in participants table; needs alias or enrichment
4. Confirm game results are present in DB:
   ```sql
   SELECT count(*) FROM game_results
   WHERE event_id IN (
     SELECT DISTINCT event_id FROM picks WHERE status = 'posted'
   );
   ```
5. Confirm SGO event status is finalized:
   - Use MCP: `get_events(eventID: "<id>", finalized: true)` and inspect `status.finalized`.

### Recovery

**If game results are missing** (ingestor not cycling or SGO not finalized yet):
- Fix ingestor cycling (§1) and wait for results to populate.
- Grading will retry automatically on next pass.

**If provenance metadata is missing** (events ingested without `ingestionCycleRunId`):
- These events cannot be graded automatically. Requires a manual correction or re-ingestion.
- Escalate to PM — do not bypass provenance checks (fail-closed invariant).

**If picks are stuck due to a bug in the grading pass**:
- Check the `grading-service.ts` version matches the expected behavior.
- Trigger a manual grading pass via API (operator role required):
  ```bash
  curl -X POST http://localhost:4000/api/grading/run \
    -H "Authorization: Bearer $UNIT_TALK_BOT_API_KEY"
  ```

**For error-outcome picks** (not skipped — actual thrown exceptions):
- Check logs for `Grading failed for pick <id>: <message>`.
- Identify the exception type (DB error, fetch error, validation error).
- Fix the underlying cause, then re-trigger grading.

### Verification

```sql
-- Confirm grading runs are succeeding
SELECT status, created_at, details
FROM system_runs
WHERE run_type = 'grading.run'
ORDER BY created_at DESC LIMIT 5;
-- Expected: status='succeeded', details.failed=0 or details.failed small

-- Confirm picks are moving from posted to settled
SELECT status, count(*) FROM picks
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY status;
```

---

## 4. Deploy Failure

### Context

Deploys run via GitHub Actions `deploy.yml` (workflow_dispatch). The pipeline is: verify → rollback-dry-run → build (4 services in parallel) → canary → promote → post-deploy smoke. Canary deploys only the API first; promote brings up all services. Rollback uses `deploy/rollback.sh` with a `--tag` parameter. The `.unit-talk-release` file on the server tracks the current image tag. The server's `.env.production` is **always rewritten** by the deploy workflow from secrets — any manual additions to `.env.production` are wiped on the next deploy.

### Detection

| Signal | How to check |
|--------|-------------|
| GitHub Actions workflow red | Check the Actions tab on the repo for the `Deploy` workflow |
| Health endpoint non-200 after promote | `ssh $DEPLOY_USER@$DEPLOY_HOST "curl -s http://localhost:4000/health"` |
| Container crash-looping | `docker compose ps` — look for `Restarting` status |
| Post-deploy smoke artifact | Download `smoke-result-*.json` from the Actions run artifacts |

### Diagnosis

1. Identify the failing step from the Actions workflow log:
   - **verify** step: type-check / test / audit failure in CI — fix in code
   - **rollback-dry-run**: `deploy/rollback.sh` script issue
   - **build**: Docker build failure — Dockerfile or multi-stage issue
   - **canary**: API container not healthy after deploy — check `docker logs api`
   - **promote**: One of the 4 services (api, worker, ingestor, discord-bot) crash-looping
   - **smoke**: Health check returning non-200 after promote

2. For canary/promote failures, SSH to server and check logs:
   ```bash
   ssh $DEPLOY_USER@$DEPLOY_HOST "cd $DEPLOY_PATH && docker compose logs --tail=100 api"
   ssh $DEPLOY_USER@$DEPLOY_HOST "cd $DEPLOY_PATH && docker compose ps"
   ```
3. Check if a required secret is missing (verify step validates 10 required secrets).
4. Check if `.env.production` was written correctly:
   ```bash
   ssh $DEPLOY_USER@$DEPLOY_HOST "head -5 $DEPLOY_PATH/.env.production"
   ```

### Recovery

**Automated rollback** (if `rollback_tag` input was provided to the workflow):
- The canary and promote steps automatically invoke `deploy/rollback.sh --tag $ROLLBACK_TAG` on health check failure.
- Monitor the workflow to confirm rollback completed.

**Manual rollback** (if automated rollback failed or `rollback_tag` was not provided):
```bash
# Get the previous release tag from server
ssh $DEPLOY_USER@$DEPLOY_HOST "cat $DEPLOY_PATH/.unit-talk-release.previous"

# Trigger a new Deploy workflow run with the rollback tag as input
gh workflow run deploy.yml -f rollback_tag=<previous_sha>
```

**For a failed build** (not a runtime issue):
- Fix the code issue on the branch.
- Re-trigger the Deploy workflow from the Actions tab.

**For a missing secret**:
- Add the secret to GitHub repository settings (Settings → Secrets → Actions).
- The verify step will list which secrets are missing in the error output.

**For environment variable issues** (env written from workflow, not persisted on server):
- Add the variable to the `printf '%s\n'` block in the `canary` and `promote` steps of `deploy.yml`.
- Do NOT add variables only to the server — they will be overwritten on next deploy.

### Verification

```bash
# Confirm health endpoint is 200
ssh $DEPLOY_USER@$DEPLOY_HOST "curl -s -o /dev/null -w '%{http_code}' http://localhost:4000/health"
# Expected: 200

# Confirm all containers are Up (not Restarting)
ssh $DEPLOY_USER@$DEPLOY_HOST "cd $DEPLOY_PATH && docker compose ps"

# Confirm current release tag matches expected
ssh $DEPLOY_USER@$DEPLOY_HOST "cat $DEPLOY_PATH/.unit-talk-release"
```

---

## 5. Provider Key / API Issue (SGO)

### Context

SGO (Sports Game Odds) is the sole provider for market ingestion, CLV, and grading. The API key is `SGO_API_KEY` (with a fallback `SGO_API_KEY_FALLBACK`). SGO Pro plan limits: 50,000 requests/hour, 300,000 objects/hour, 7,000,000 objects/day. Auth uses `x-api-key` header. Key status can be checked via `GET /v2/account/usage`. Unit Talk production uses `includeAltLines=false` (disabled permanently, UTV2-1266). The ingestor resolves the active SGO key during startup and records it in loop progress telemetry.

### Detection

| Signal | How to check |
|--------|-------------|
| Ingestor logs show `401 Unauthorized` or `403 Forbidden` | `docker compose logs ingestor | grep -E "401|403|unauthorized|forbidden"` |
| Ingestor logs show `SGO key resolution` failures | `docker compose logs ingestor | grep -i "sgo key"` |
| No new `provider_offer_history` rows despite ingestor cycling | `SELECT max(snapshot_at) FROM provider_offer_history;` |
| Rate limit exceeded | SGO returns `429` — check `docker compose logs ingestor | grep 429` |
| Usage check | `npx tsx scripts/sgo-key-status.ts` |

```bash
# Direct SGO usage check (requires SGO_API_KEY in env)
curl -H "x-api-key: $SGO_API_KEY" https://api.sportsgameodds.com/v2/account/usage
```

The response `rateLimits.perHour.currentRequests` vs `maxRequests` shows consumption.

### Diagnosis

1. Confirm the error type from ingestor logs:
   - `401 Unauthorized` → key is invalid or expired
   - `403 Forbidden` → key is valid but plan restriction (e.g., attempting Rookie-plan restricted data)
   - `429 Too Many Requests` → rate limit exceeded
   - `Connection refused` / `ECONNRESET` → network issue, not key issue (see §6)

2. Check if `SGO_API_KEY_FALLBACK` is configured:
   ```bash
   ssh $DEPLOY_USER@$DEPLOY_HOST "grep SGO_API_KEY $DEPLOY_PATH/.env.production"
   ```

3. For rate limits, check the SGO usage endpoint:
   ```bash
   curl -H "x-api-key: $SGO_API_KEY" https://api.sportsgameodds.com/v2/account/usage \
     | python3 -m json.tool
   ```
   Look at `rateLimits.perHour.currentEntities` vs `maxEntities` (300,000/hr limit on Pro).

4. Confirm the plan includes Pinnacle (Pro required — Rookie permanently ruled out per §3.7):
   ```bash
   curl -H "x-api-key: $SGO_API_KEY" \
     "https://api.sportsgameodds.com/v2/events?bookmakerID=pinnacle&limit=1"
   ```

### Recovery

**Expired or invalid key:**
1. Obtain a new SGO Pro API key from the SGO dashboard at `sportsgameodds.com`.
2. Update the GitHub secret `SGO_API_KEY` (Settings → Secrets → Actions).
3. Trigger a new Deploy workflow run to write the new key to `.env.production`.
4. Restart the ingestor:
   ```bash
   ssh $DEPLOY_USER@$DEPLOY_HOST "cd $DEPLOY_PATH && docker compose restart ingestor"
   ```

**Rate limit exceeded (temporary 429):**
1. Reduce ingestor polling frequency immediately:
   - Set `UNIT_TALK_INGESTOR_PEAK_POLL_MS=120000` (2 min) to reduce request rate.
   - Update `.env.production` and restart ingestor.
2. Wait for the rate limit window to reset (per-hour window resets at the top of the hour).
3. Check if `includeAltLines` is erroneously enabled — confirm it is `false` in all SGO fetch paths.
4. Enable Pinnacle-only mode during peak to reduce object count:
   - `UNIT_TALK_INGESTOR_PINNACLE_ONLY_PEAK=true` (already production default).

**SGO `notice` field in response (plan restriction):**
- If the API response contains `"notice": "Response is missing N events..."`, the plan is being exceeded.
- Do not proceed on degraded data — escalate to PM for plan upgrade decision.

### Verification

```bash
# Confirm ingestor is fetching successfully
docker compose logs --tail=30 ingestor | grep -E "ingest|cycle|complete"

# Confirm SGO key is accepted
curl -s -o /dev/null -w "%{http_code}" \
  -H "x-api-key: $SGO_API_KEY" \
  "https://api.sportsgameodds.com/v2/account/usage"
# Expected: 200

# Confirm new offers are being written
# SQL: SELECT max(snapshot_at) FROM provider_offer_history;
# Expected: within the last polling interval
```

---

## 6. Supabase Degraded

### Context

Unit Talk uses Supabase (project ref `zfzdnfwdarxucxtaojxm`) as its sole database. All services fail-closed when Supabase is unavailable (`UNIT_TALK_API_RUNTIME_MODE=fail_closed`). Known Supabase failure modes: platform incidents (check `status.supabase.com`), PostgREST timeouts from oversized writes (UTV2-1294: 17.8MB MLB odds archive payload causing PostgREST timeouts), connection pool exhaustion, and autovacuum lag causing dead tuple bloat and planner inaccuracy.

The ingestor has a circuit breaker (`apps/ingestor/src/circuit-breaker.ts`) to detect and back off from repeated DB failures. The API returns 503 when Supabase is unreachable.

### Detection

| Signal | How to check |
|--------|-------------|
| Health endpoint returns non-200 or `{"status":"degraded"}` | `curl -s http://localhost:4000/health` |
| API logs show `connection refused`, `PGRST` errors, or `504` | `docker compose logs api | grep -E "PGRST|504|ECONNREFUSED|connection"` |
| `system_runs` writes failing | No new rows in `system_runs` for > 5 min |
| Supabase platform incident | Check `status.supabase.com` |
| PostgREST `502`/`503` | Supabase Dashboard → Logs → PostgREST |

```bash
# Quick connectivity check from server
ssh $DEPLOY_USER@$DEPLOY_HOST \
  "curl -s -o /dev/null -w '%{http_code}' '$SUPABASE_URL/rest/v1/system_runs?select=id&limit=1' \
   -H 'apikey: $SUPABASE_ANON_KEY'"
# Expected: 200 (or 206). Non-200 = Supabase degraded.
```

### Diagnosis

1. Check `status.supabase.com` — if platform incident, wait for resolution. Do not attempt DB fixes during platform outage.

2. Check for oversized archive writes triggering PostgREST timeout:
   - Look for `413 Request Entity Too Large` or `504 Gateway Timeout` in API or ingestor logs.
   - The `archive-payload-guard.ts` module enforces a size limit on archive writes.
   - Check the guard is active: `grep -r "archive-payload-guard" apps/ingestor/src/`.

3. Check for table bloat:
   ```sql
   SELECT relname, n_dead_tup, last_autovacuum, pg_size_pretty(pg_total_relation_size(oid))
   FROM pg_stat_user_tables
   JOIN pg_class ON relname = pg_class.relname
   WHERE n_dead_tup > 100000
   ORDER BY n_dead_tup DESC;
   ```

4. Check connection pool saturation (Supabase Dashboard → Database → Connection Pooling).

5. Check for ingestor circuit breaker tripped:
   ```bash
   docker compose logs ingestor | grep -i "circuit\|breaker\|open\|backoff"
   ```

### Recovery

**Platform incident (status.supabase.com showing degraded):**
- All services fail-closed — no action needed except monitoring.
- Do not restart services repeatedly during an incident — they will fail-closed and restart automatically.
- Wait for platform recovery. Monitor `status.supabase.com`.

**PostgREST timeout from oversized payload:**
- The `archive-payload-guard.ts` should prevent writes exceeding the size limit.
- If an oversized write got through, PostgREST will timeout and the write fails. No data corruption.
- Restart the affected service after the payload issue is fixed.

**Table bloat / autovacuum lag:**
- PM approval required before running VACUUM on production.
- After PM approval:
  ```sql
  VACUUM ANALYZE system_runs;
  VACUUM ANALYZE provider_offer_history;
  ```
- After VACUUM, run `ANALYZE` to update planner statistics.

**Circuit breaker open on ingestor:**
- The ingestor backs off automatically when the circuit breaker is open.
- It will retry on the next polling interval.
- If stuck, restart the ingestor after Supabase recovers:
  ```bash
  ssh $DEPLOY_USER@$DEPLOY_HOST "cd $DEPLOY_PATH && docker compose restart ingestor"
  ```

**Connection pool exhaustion:**
- Restart services to release idle connections:
  ```bash
  ssh $DEPLOY_USER@$DEPLOY_HOST "cd $DEPLOY_PATH && docker compose restart api worker"
  ```
- If persistent, check for connection leaks in recent code changes.

### Verification

```bash
# Confirm API health
curl -s http://$DEPLOY_HEALTH_URL/health | python3 -m json.tool
# Expected: {"status": "ok", ...}

# Confirm Supabase is accepting writes
# SQL:
INSERT INTO system_runs (run_type, actor, status, details)
VALUES ('healthcheck', 'runbook-verify', 'succeeded', '{}')
RETURNING id, created_at;
-- Immediately delete after confirming:
DELETE FROM system_runs WHERE actor = 'runbook-verify';

# Confirm ingestor is cycling (not circuit-broken)
docker compose logs --tail=20 ingestor | grep -v "ERROR"
```

---

## Escalation Path

| Severity | Condition | Action |
|----------|-----------|--------|
| P1 | Settlement/grading stopped, picks stuck > 4h post-event | Page PM, open Linear incident |
| P1 | Supabase platform incident > 30 min | Monitor status.supabase.com, notify PM |
| P2 | Ingestor not cycling > 60 min | Attempt restart per §1, then page PM |
| P2 | Deploy failure on canary | Rollback per §4, then investigate |
| P3 | SGO rate limit exceeded | Reduce poll frequency per §5, monitor |
| P3 | DB timeout on single query | Check indexes/bloat per §2, no immediate escalation |

---

## Related Documents

- Provider knowledge: `docs/05_operations/PROVIDER_KNOWLEDGE_BASE.md`
- Execution truth model: `docs/05_operations/EXECUTION_TRUTH_MODEL.md`
- Program status: `docs/06_status/PROGRAM_STATUS.md`
- Known debt: `docs/06_status/KNOWN_DEBT.md`
- Deploy workflow: `.github/workflows/deploy.yml`
- Grading service: `apps/api/src/grading-service.ts`
- Ingestor index: `apps/ingestor/src/index.ts`
- Circuit breaker: `apps/ingestor/src/circuit-breaker.ts`
- Archive payload guard: `apps/ingestor/src/archive-payload-guard.ts`
