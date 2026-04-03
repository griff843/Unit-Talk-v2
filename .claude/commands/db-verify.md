# /db-verify

Verify live DB state for a change. Report truth first. Do not fix while checking.

---

## When to invoke

- After any implementation that writes to the DB
- During T1 or T2 proof capture
- When a pick, outbox row, or settlement record is in an unexpected state
- When operator surface and DB state appear to disagree
- As an independent verification lane (do not change runtime code in this lane)

---

## Preferred query order

Always prefer higher sources. Only fall back down when the higher source is unavailable.

1. **Repo CLI / API route / live DB query** ← always preferred
2. **Operator surface** (`GET /api/operator/snapshot`, `GET /api/operator/recap`)
3. **Runtime / API response** (submission endpoint, pick trace endpoint)
4. **Worker log** ← last resort only

If verifying, do not "fix while checking." Report truth first. Open a separate lane to fix.

---

## Step 1 — Identify scope

Determine which tables are relevant to the change being verified.

| Change type | Tables to check |
|-------------|----------------|
| Schema migration | Confirm columns/constraints exist post-migration via `information_schema` or Supabase MCP |
| Submission | `submissions`, `picks`, `pick_lifecycle`, `submission_events` |
| Promotion | `pick_promotion_history`, `picks.promotion_status`, `picks.promotion_target` |
| Distribution / outbox | `distribution_outbox`, `distribution_receipts` |
| Settlement | `settlement_records`, `picks.status`, `picks.settled_at` |
| Lifecycle transition | `pick_lifecycle`, `picks.status` |
| Audit behavior | `audit_log` — always query by `entity_ref = pick_id`, never by `entity_id` |
| Dead-letter / failed delivery | `distribution_outbox` where `status IN ('failed', 'dead_letter')` |

---

## Step 2 — Query each relevant table

For each table, record:
- Row count found for the entity under test
- Key field values (IDs, statuses, timestamps, foreign keys)
- Whether expected rows are present or absent

### picks table
```sql
SELECT id, status, promotion_status, promotion_target, promotion_score,
       posted_at, settled_at, created_at
FROM picks
WHERE id = '<pick_id>';
```

### pick_lifecycle table
```sql
SELECT from_state, to_state, actor, created_at
FROM pick_lifecycle
WHERE pick_id = '<pick_id>'
ORDER BY created_at ASC;
```

### pick_promotion_history table
```sql
SELECT target, promotion_status, promotion_score, suppression_reason, version, created_at
FROM pick_promotion_history
WHERE pick_id = '<pick_id>'
ORDER BY created_at ASC;
```

### distribution_outbox table
```sql
SELECT id, target, status, claimed_at, claimed_by, idempotency_key, created_at
FROM distribution_outbox
WHERE pick_id = '<pick_id>';
```

### distribution_receipts table
```sql
SELECT id, channel, message_id, delivered_at, idempotency_key
FROM distribution_receipts
WHERE pick_id = '<pick_id>';
```

### settlement_records table
```sql
SELECT id, status, result, source, corrects_id, created_at
FROM settlement_records
WHERE pick_id = '<pick_id>'
ORDER BY created_at ASC;
```

### audit_log table
```sql
-- IMPORTANT: never query by entity_id for a pick — query by entity_ref
SELECT action, entity_id, entity_ref, actor, created_at
FROM audit_log
WHERE entity_ref = '<pick_id>'
ORDER BY created_at ASC;
```

---

## Step 3 — Check against expected state

For each table queried, compare actual rows against expected state:

**picks**
- `status` matches the last `to_state` in `pick_lifecycle`
- `promotion_status` matches the winning `pick_promotion_history` row
- `posted_at` is set if status is `posted` or later
- `settled_at` is set if status is `settled`

**pick_lifecycle**
- First `to_state` is `validated`
- Each transition follows allowed edges (see `/pick-lifecycle`)
- No gaps in the chain (e.g. `posted` without a prior `queued` row)
- Final `to_state` matches `picks.status`

**pick_promotion_history**
- Up to 2 rows per pick (one per policy)
- At least one `qualified` row if `picks.promotion_status = qualified`
- No `qualified` row if `picks.promotion_status = suppressed`

**distribution_outbox**
- `status = sent` if pick is `posted`
- No `failed` or `dead_letter` rows if the slice requires delivery health
- `target` matches `picks.promotion_target` (with `discord:` prefix)

**distribution_receipts**
- Receipt exists if outbox is `sent`
- `channel` matches `picks.promotion_target`
- `message_id` is a non-null Discord snowflake

**settlement_records**
- Row exists if `picks.status = settled`
- Original row is never mutated — corrections appear as new rows with `corrects_id` set
- `source != feed` (feed settlement is blocked at service layer)

**audit_log**
- `promotion.qualified` or `promotion.suppressed` entry exists for each policy evaluation
- `distribution.sent` entry exists if pick was posted (note: `entity_ref` may be null on this action — this is normal)
- `settlement.recorded` entry exists if pick is settled

---

## Step 4 — Classify findings

For each finding, classify as:

| Classification | Meaning |
|---------------|---------|
| `VERIFIED` | Row exists, fields match expected state, chain is complete |
| `GAP` | Expected row is absent but absence is explainable (e.g. pick not yet settled) |
| `INCONSISTENT` | Evidence contradicts claimed state (e.g. `picks.status=posted` but no outbox `sent` row) |
| `ANOMALY` | Row exists but with unexpected values (e.g. `source=feed` on settlement) |
| `NOT CHECKED` | Table was not queried in this session |

Never upgrade a `GAP` to `VERIFIED` without querying the actual row.

---

## Step 5 — Report truth

State findings exactly. Do not soften inconsistencies. Do not fix in this lane.

If you find an inconsistency:
- Name it precisely
- Identify which table and field contradicts which other table and field
- Note whether it is a data bug, a code bug, or a known quirk (see known quirks below)

---

## Known quirks — do not flag as bugs

1. `audit_log.entity_ref = null` on `distribution.sent` entries — normal, worker does not write entity_ref on sent events
2. Picks without `confidence` score `61.5` (static fallback) — correctly suppressed, not a bug
3. Two `pick_promotion_history` rows per pick — correct, one per policy
4. `picks.posted_at` and `picks.settled_at` may lag slightly — application-maintained, not trigger-maintained
5. `audit_log.entity_id` is never the pick_id — always query audit_log via `entity_ref`
6. `draft` status exists in the system but is unused in V2

---

## Output format

```
## DB Verification Report

### Entity
Pick ID: <uuid> / N/A
Change type: <submission | promotion | distribution | settlement | lifecycle | schema | audit>
Tables queried: [list]

### Findings

#### picks
- Row found: YES / NO
- status: <value> | ABSENT
- promotion_status: <value> | ABSENT
- Denormalized fields (posted_at / settled_at): <values or null>
- Verdict: VERIFIED / GAP / INCONSISTENT / ANOMALY

#### pick_lifecycle
- Rows found: <count>
- Chain: <from_state → to_state, ...>
- Chain complete: YES / NO / IN-PROGRESS
- Final to_state matches picks.status: YES / NO
- Verdict: VERIFIED / GAP / INCONSISTENT

#### pick_promotion_history
- Rows found: <count>
- Results: best-bets=<status>, trader-insights=<status>
- Consistent with picks.promotion_status: YES / NO
- Verdict: VERIFIED / GAP / INCONSISTENT

#### distribution_outbox
- Rows found: <count>
- Status(es): <values>
- Target matches promotion_target: YES / NO / N/A
- Failed / dead_letter rows: NONE / <count> (flag)
- Verdict: VERIFIED / GAP / INCONSISTENT / ANOMALY

#### distribution_receipts
- Rows found: <count>
- channel: <value>
- message_id: <value or null>
- Verdict: VERIFIED / GAP / NOT CHECKED

#### settlement_records
- Rows found: <count>
- Latest: status=<value>, result=<value>, source=<value>
- Correction chain: NONE / <describe>
- source=feed anomaly: NONE / FLAGGED
- Verdict: VERIFIED / GAP / INCONSISTENT / ANOMALY

#### audit_log
- Entries found: <count>
- Actions found: [list]
- Expected entries missing: NONE / [list]
- Verdict: VERIFIED / GAP / NOT CHECKED

### Summary
| Table | Verdict | Notes |
|-------|---------|-------|
| picks | VERIFIED | ... |
| pick_lifecycle | ... | ... |
| ... | ... | ... |

### Inconsistencies requiring investigation
- [describe each precisely] / NONE

### Gaps (explainable absences)
- [describe each] / NONE

### Anomalies
- [describe each] / NONE

### Overall verdict
VERIFIED / PARTIALLY VERIFIED / INCONSISTENT / UNVERIFIED

Reason: <one sentence>
```

---

## Usage examples

```
# Verify a pick after a lifecycle change
/db-verify pick_id="eb12a6c2-..." change_type=lifecycle

# Verify settlement after recording
/db-verify pick_id="eb12a6c2-..." change_type=settlement

# Verify delivery health after outbox flush
/db-verify pick_id="eb12a6c2-..." change_type=distribution

# Verify schema after a migration
/db-verify change_type=schema

# Full verification for T1 proof
/db-verify pick_id="eb12a6c2-..." change_type=full
```
