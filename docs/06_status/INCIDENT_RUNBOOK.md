# Security & Incident Runbook

**Status:** RATIFIED  
**Date:** 2026-04-30  
**Linear:** UTV2-802  
**Authority:** Canonical incident response procedure for Unit Talk V2. Supersedes any ad-hoc runbook fragments in Notion or chat history.  
**Related:** `docs/06_status/INCIDENTS/` (incident log), `ROLLBACK_TEMPLATE.md`, `REQUIRED_SECRETS.md`, `SECRETS_INVENTORY.md`

---

## 1. Overview

This runbook defines how incidents are detected, triaged, contained, fixed, verified, and closed. It also provides playbooks for the most common incident types.

**Fail-closed principle:** When in doubt, shut the affected component down rather than letting it operate in an unknown state. A silent wrong pick is worse than a stopped pipeline.

**Single source of truth:** Incidents are tracked in `docs/06_status/INCIDENTS/`. Every incident gets a file. No incident is considered "resolved" without a closed incident file and a linked PR.

---

## 2. Severity Definitions

| Severity | Meaning | Target Response |
|---|---|---|
| **Critical** | Pipeline DOWN, data corruption, incorrect picks delivered to Discord, secret exposure | Immediate — within 15 minutes |
| **High** | Worker down > 10 min, DB constraint violation, scoring producing wrong results, outbox stuck | Within 1 hour |
| **Medium** | Stale data not refreshing, grading delayed, operator surfaces showing wrong data | Within 4 hours |
| **Low** | Non-blocking operational issue, cosmetic bug, single pick failure | Next business cycle |

When severity is unclear, **escalate to High** until proven otherwise.

---

## 3. Detection Signals

Run `pnpm ops:brief` as the first step whenever any signal fires.

| Signal | Source | Meaning |
|---|---|---|
| Worker verdict: DOWN | `ops:brief` → pipeline section | Worker has no heartbeat in health window — picks not being delivered |
| `⛔ CRITICAL` in ops:brief | `ops:brief` | At least one pipeline component is in critical state |
| `last successful run: N hours ago` | `ops:brief` | Ingestor not running; provider data going stale |
| Disk alert email | `scripts/disk-growth-alert.ts` | DB approaching capacity threshold |
| `provider_cycle_status.freshnessStatus = 'stale'` | DB query | Ingestor cycle completed but data is stale |
| `market_universe.is_stale = true` at high rate | DB query | Materializer not running or provider API down |
| `outbox` rows stuck > 10 min | DB query | Worker claiming but not delivering |
| Discord webhook failure | Worker logs | Discord API returning errors |
| Auth failure spike | API logs | Possible credential rotation or unauthorized access |
| `provider_ingestion_failures` rows | DB table | Provider API failures during ingest cycle |

---

## 4. General Response Protocol

### Step 1 — Detect & Scope

```bash
pnpm ops:brief
```

Read: branch, dirty files, Codex lanes, pipeline health, Linear queue. Do not take action until you understand the scope.

Questions to answer before proceeding:
- Is the worker running? (`pipeline.worker`)
- Is the ingestor running? (`pipeline.last_run_status`, `last_successful_run`)
- Are picks stuck in the outbox?
- Is data fresh? (`market_universe.is_stale` rate)

### Step 2 — Open an Incident File

Before making any changes, open an incident file:

```bash
cp docs/06_status/INCIDENTS/_TEMPLATE.md docs/06_status/INCIDENTS/INC-$(date +%Y-%m-%d)-<slug>.md
```

Fill in the header fields immediately: Incident ID, Title, Severity, Status=Open, Detected time, Owner. Leave unresolved fields as `n/a — TBD`.

Do not rely on chat/Notion as the incident record. The file IS the record.

### Step 3 — Contain

Stop the bleeding before diagnosing root cause. Common containment actions:

- **Worker producing wrong picks:** Set `SYNDICATE_MACHINE_ENABLED=false` to stop automated pick generation
- **Ingestor corrupting data:** Stop the ingestor process; check `provider_cycle_status` for stale/failed cycles
- **Outbox stuck:** Do not manually delete rows; check worker logs for the specific delivery failure
- **DB approaching capacity:** Pause ingest; do not drop data; execute archival or retention policy first
- **Secret potentially exposed:** Rotate immediately via Supabase dashboard; update `local.env` and any deployed env; audit `audit_log` for access from the compromised credential

### Step 4 — Diagnose Root Cause

Check (in order):
1. Recent commits to `main` that touched the affected component
2. `provider_cycle_status` for freshness/proof status
3. `audit_log` for the affected entity_id around the incident time
4. Worker process logs for the delivery failure
5. DB for constraint violations (`SQLSTATE` in error)

Root cause must be identified before applying a fix. A fix without a root cause is a guess.

### Step 5 — Fix

Fix in a branch. Run `pnpm verify` before merging. For Critical/High severity: get a second review if possible.

If a migration is part of the fix, follow `migration_cutover_plan.md`. Never apply DDL directly in SQL editor without documenting it in the migration ledger.

### Step 6 — Verify

After merging, run:

```bash
pnpm verify       # static checks
pnpm test:db      # live DB proof
pnpm ops:brief    # confirm health restored
```

For Critical/High: collect runtime evidence (worker heartbeat, outbox cleared, picks flowing) before declaring resolved.

### Step 7 — Close the Incident File

Update the incident file:
- `Status: Resolved`
- `Resolved:` — actual timestamp
- `Fix PR` and `Fix commit` filled in
- `Remediation` section with concrete changes
- `Prevention / Lessons / New Controls` — at least one mechanical control, not just prose

Commit the closed incident file to `main`.

---

## 5. Playbooks by Incident Type

### PB-01: Worker DOWN

**Detection:** `ops:brief` → `Worker verdict: DOWN — no runs or heartbeats in health window`

**Containment:**
- Verify the worker process is not running: check the process supervisor or hosting environment
- Do not restart before diagnosing why it stopped

**Diagnosis:**
```bash
# Check last worker run in DB
# SELECT * FROM system_runs WHERE run_type LIKE 'worker%' ORDER BY created_at DESC LIMIT 10;

# Check for stuck outbox rows
# SELECT COUNT(*) FROM distribution_outbox WHERE claimed_at IS NOT NULL AND delivered_at IS NULL;
```

**Common causes:**
1. OOM crash — check process memory
2. DB connection pool exhausted — check `SUPABASE_CONNECTION_STRATEGY.md`
3. Unhandled exception in delivery adapter — check worker logs for last error
4. API rate limit from Discord (429) causing crash loop
5. Environment variable missing after deployment

**Fix:**
- Resolve the root cause
- Restart the worker
- Monitor for 15 minutes after restart to confirm picks are flowing

**Verify:**
```bash
pnpm ops:brief  # worker verdict should change to healthy
```

---

### PB-02: Ingestor Stale / Not Running

**Detection:** `ops:brief` → `Last successful run: Nh ago` where N > 2; or `market_universe.is_stale` rate high

**Containment:** No immediate containment needed unless provider quota is being consumed without result.

**Diagnosis:**
```bash
# Check provider_cycle_status for recent failures
# SELECT provider_key, league, freshness_status, stage_status, last_error, created_at
# FROM provider_cycle_status
# ORDER BY created_at DESC LIMIT 20;

# Check provider_ingestion_failures
# SELECT * FROM provider_ingestion_failures ORDER BY created_at DESC LIMIT 10;
```

**Common causes:**
1. SGO API quota exhausted — check `quotaSummary.sgo.creditsRemaining` in `getProviderHealth()`
2. SGO API key rotated or invalid — check `SGO_API_KEY` in env
3. Network timeout — SGO fetch budget exceeded (UTV2-756 guard should catch this)
4. DB write timeout during merge — check `db_statement_timeout` in failure categories
5. Ingestor process crashed — check process supervisor

**Fix:**
- If quota exhausted: wait for reset; document quota burn in incident file
- If key invalid: rotate via SGO dashboard; update `local.env` + deployed env
- If DB timeout: check table size; may indicate need for retention enforcement (UTV2-803)

---

### PB-03: DB Constraint Violation

**Detection:** API logs: `SQLSTATE 23514` (CHECK constraint) or `SQLSTATE 23505` (unique violation); or test suite failures referencing specific constraint names

**Severity:** High — pick lifecycle may be broken (see INC-2026-04-10-utv2-519 precedent)

**Containment:**
- Identify which constraint is failing
- Check if it is in the critical lifecycle path (picks, pick_lifecycle, distribution_outbox)
- If lifecycle constraint: set `SYNDICATE_MACHINE_ENABLED=false` immediately; picks cannot be safely created until fixed

**Diagnosis:**
- The error message includes the constraint name (`pick_lifecycle_to_state_check`, `picks_status_check`, etc.)
- Check the migration that introduced the constraint and the allowed values
- Cross-reference with the lifecycle state machine to find the missing state

**Fix:**
- Add the missing allowed value to the CHECK constraint via a new migration
- Re-run the proof path that exposed the failure
- Verify with `pnpm test:db`

**Precedent:** INC-2026-04-10 — `awaiting_approval` state was missing from `pick_lifecycle_to_state_check`. Fix was DDL in a new migration + atomic transition RPC. See `docs/06_status/INCIDENTS/INC-2026-04-10-utv2-519-awaiting-approval-constraint-gap.md`.

---

### PB-04: Picks Stuck in Outbox

**Detection:** `ops:brief` → outbox counts non-zero; or `SELECT COUNT(*) FROM distribution_outbox WHERE claimed_at IS NOT NULL AND delivered_at IS NULL` returns > 0

**Containment:** Do NOT manually delete outbox rows. The worker uses atomic claim — manual deletion creates audit gaps.

**Diagnosis:**
```bash
# Find stuck claimed rows
# SELECT id, pick_id, target, claimed_at, last_error, attempt_count
# FROM distribution_outbox
# WHERE claimed_at IS NOT NULL AND delivered_at IS NULL
# ORDER BY claimed_at ASC;
```

**Common causes:**
1. Discord API returning 4xx/5xx — check delivery adapter logs
2. Pick in unexpected lifecycle state — worker may be correctly refusing to deliver
3. Network interruption during delivery
4. Worker crashed mid-delivery (claimed but not delivered before crash)

**Fix:**
- If Discord API error: wait for Discord recovery; worker will retry on restart
- If worker crashed mid-claim: the atomic `confirmDeliveryAtomic` RPC prevents duplicate delivery; restart worker, it will retry
- If pick in wrong state: investigate the lifecycle issue separately; do not force-deliver

---

### PB-05: Scoring / Grading Producing Wrong Results

**Detection:** Manual spot-check shows incorrect outcome (win/loss/push); CLV values implausible; calibration gap > 0.15

**Severity:** Critical if incorrect outcomes have been delivered to Discord

**Containment:**
1. Immediately set `SYNDICATE_MACHINE_ENABLED=false`
2. If incorrect picks were delivered to Discord: do not delete them; document the affected pick IDs
3. Do not run another grading cycle until root cause is found

**Diagnosis:**
- Check `grading-service.ts` for the sport/market that failed
- Check SGO status fields: only `status.finalized` is reliable (not `status.completed`) per `PROVIDER_KNOWLEDGE_BASE.md`
- Check for the `status.completed && status.finalized` vs `status.finalized` only bug (INC-2026-04-04 precedent)
- Verify `odds.<oddID>.score` is being used, not `results.game`
- Check `settlement_records` for the affected picks

**Precedent:** 2026-04-04 — 22 playoff picks unsettled because code checked `status.completed && status.finalized` instead of `status.finalized` only. Fix was in `grading-service.ts`. Never use `status.completed` for settlement authority.

---

### PB-06: Incorrect Picks Delivered to Discord

**Severity:** Critical — user-visible data error

**Containment:**
1. Stop the worker immediately (`SYNDICATE_MACHINE_ENABLED=false`)
2. Document the affected pick IDs and Discord message IDs
3. Do NOT delete Discord messages without PM approval

**Assessment:**
- Are the incorrect picks graded incorrectly, or just questionable?
- If graded incorrectly: this is a grading incident (PB-05) that resulted in delivery
- If scored incorrectly: this is a scoring incident

**Fix:**
- Correct the settlement via the `POST /api/settlement/correct` path (creates correction chain, does not mutate original rows)
- For Discord: PM decides whether to post a correction message. Do not delete original.
- Update `settlement_records` with corrected outcome; the `corrects_id` FK preserves the chain

---

### PB-07: DB Approaching Capacity / Disk Growth

**Detection:** `scripts/disk-growth-alert.ts` email alert; `pnpm runtime:health` showing DB storage > threshold

**Severity:** High — pipeline will fail if DB runs out of space

**Containment:**
- Do NOT drop any table or run destructive DDL until you know what is growing
- Check which table is largest

```sql
-- Run in Supabase SQL editor
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 20;
```

**Common cause:** `provider_offers` growth (see UTV2-803 / UTV2-772 for the retention solution). Do not apply ad-hoc retention without the migration-governed approach.

**Fix:** Follow the retention policy migration process in `migration_cutover_plan.md`. Never run `DELETE FROM provider_offers` directly.

---

### PB-08: Secret / Credential Exposure

**Detection:** Unexpected auth failures; external notification of leaked key; git history contains secret

**Severity:** Critical

**Immediate actions (in order):**
1. Rotate the compromised credential immediately:
   - SGO API key: SGO dashboard → generate new key → update `local.env` + deployed env + `REQUIRED_SECRETS.md` reference
   - Supabase service role key: Supabase dashboard → Settings → API → Regenerate
   - Discord bot token: Discord developer portal → reset token
   - API keys in `local.env`: rotate all of them if source of exposure is unclear
2. Revoke the old credential at the provider
3. Audit `audit_log` and Supabase access logs for any activity under the compromised credential
4. Check git history: if the secret was committed, remove it via `git filter-repo` and force-push (requires PM approval for main)

**NEVER:**
- Commit secrets to any branch, even temporary ones
- Store secrets in Notion, Claude memory, or chat history
- Reuse a rotated secret

**Reference:** `REQUIRED_SECRETS.md`, `SECRETS_INVENTORY.md`

---

### PB-09: RLS / Authorization Failure

**Detection:** API returning 403 for authenticated requests; Supabase RLS errors in logs; unexpected data isolation gaps

**Containment:**
- Check if the failure is read-only or write-path
- If write-path: stop the affected write operations until root cause is found

**Diagnosis:**
- Check `SUPABASE_CONNECTION_STRATEGY.md` for the service role vs. anon key usage policy
- Verify RLS policies in Supabase dashboard against the expected policy for the affected table
- Check if a recent migration changed table ownership or RLS policy

**Note:** `apps/api` uses the service role key for all writes (bypasses RLS by design). RLS is a defense-in-depth layer for direct Supabase access, not the primary auth gate. The primary gate is the API Bearer token.

---

## 6. Rollback Procedure

For any Critical/High incident requiring code rollback:

```bash
# Identify the last clean commit
git log --oneline -20 origin/main

# Create a revert branch
git checkout -b hotfix/revert-<slug>

# Revert the specific commit(s)
git revert <commit-sha> --no-edit

# Run verify before merging
pnpm verify

# Open a PR — do not merge without review for Critical incidents
```

For migration rollback, use `ROLLBACK_TEMPLATE.md`. Migration rollbacks require PM approval.

---

## 7. Post-Incident Review

Every High or Critical incident requires a completed incident file with a `Prevention / Lessons / New Controls` section before it is marked Resolved.

The prevention section must contain at least one **mechanical control** — a test, a check, a validation gate, or an enforced policy. Prose reminders ("remember to check X") are insufficient.

Examples of mechanical controls:
- New test covering the failed case
- New assertion in `pnpm test:db` proving the constraint is correct
- New validation in the staging pipeline
- New alert condition in `disk-growth-alert.ts`
- Updated `ops:brief` check for the missed signal

---

## 8. Incident Log Index

All incidents are in `docs/06_status/INCIDENTS/`. Current log:

| Incident ID | Title | Severity | Status |
|---|---|---|---|
| INC-2026-04-10-utv2-519-awaiting-approval-constraint-gap | `awaiting_approval` lifecycle CHECK constraint gap + non-atomic `transitionPickLifecycle` | High | Resolved |

New incidents: copy `_TEMPLATE.md`, fill in the header immediately on detection, commit the file even if the investigation is ongoing.
