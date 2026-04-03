# /verify-pick

Verify the actual V2 lifecycle state and proof chain for a single pick.

Answers: what happened to this pick, what evidence exists, and where are there gaps or inconsistencies?

---

## Inputs

- **pick_id** (required) — UUID of the pick to verify
- **external_ref** (optional) — external reference string to search by if pick_id is unknown
- **depth** (optional, default: `standard`)
  - `quick` — pick existence + current status + lifecycle chain only
  - `standard` — full lifecycle + promotion + outbox/delivery (no audit log deep dive)
  - `full` — everything including audit log, submission events, and downstream recap

---

## Execution

### Step 0 — Resolve Pick Identity

**If pick_id given:**
Query `picks` table: `id = <pick_id>`

**If only external_ref given:**
Query `submissions` table: `external_ref = <value>`, then join to `picks` via `submission_id`.

**If neither resolves a row:**
Output `Verdict: NOT FOUND` and stop.

---

### Step 1 — Pick Identity (all depths)

Query `picks` table for the row. Report:

| Field | DB column |
|-------|-----------|
| Pick ID | `id` |
| Submission ID | `submission_id` |
| Source | `source` |
| Market | `market` |
| Selection | `selection` |
| Odds | `odds` |
| Stake units | `stake_units` |
| Confidence | `confidence` |
| Current status | `status` ← this is the lifecycle state |
| Promotion status | `promotion_status` |
| Promotion target | `promotion_target` |
| Promotion score | `promotion_score` |
| Promotion decided at | `promotion_decided_at` |
| Approval status | `approval_status` ← valid values: `pending \| approved \| rejected` |
| Posted at | `posted_at` (denormalized cache) |
| Settled at | `settled_at` (denormalized cache) |
| Created at | `created_at` |

**Valid lifecycle states:** `validated | queued | posted | settled | voided`
**Valid promotion statuses:** `not_eligible | eligible | qualified | promoted | suppressed | expired`

Flag any value not in the above lists.

---

### Step 2 — Lifecycle Chain (all depths)

Query `pick_lifecycle` table: `pick_id = <pick_id>`, order by `created_at ASC`.

Report each row:
- `from_state` → `to_state`
- `created_at`
- `actor` (if present)

**Check:**
- First `to_state` must be `validated` (V2 — all picks start at validated, draft is unused)
- Each transition must follow allowed transitions:
  ```
  validated → queued | voided
  queued    → posted | voided
  posted    → settled | voided
  settled   → (terminal)
  voided    → (terminal)
  ```
- Final `to_state` must match `picks.status`
- If `picks.status = posted` but no `queued` row exists in lifecycle chain → flag as gap

---

### Step 3 — Scoring / Promotion (standard + full)

Query `pick_promotion_history` table: `pick_id = <pick_id>`, order by `created_at ASC`.

Report each row:
- `target` (best-bets or trader-insights)
- `promotion_status` (qualified / suppressed / not_eligible)
- `promotion_score`
- `suppression_reason` (if present)
- `version`
- `created_at`

**Check:**
- Expect up to 2 rows per pick (one per policy: best-bets + trader-insights)
- If `picks.promotion_target IS NOT NULL`, there must be at least one `qualified` row for that target
- If `picks.promotion_status = 'qualified'` but no `pick_promotion_history` row shows `qualified` → INCONSISTENT
- If `picks.promotion_status = 'suppressed'` but a `qualified` row exists → INCONSISTENT
- Note which policy won (trader-insights > best-bets in priority)

**Score context:**
- Best Bets gate: minimumScore ≥ 70
- Trader Insights gate: minimumScore ≥ 80, edge ≥ 85, trust ≥ 85
- Smart Form V1 picks without `confidence` score 61.5 (static fallback) — correctly suppressed

---

### Step 4 — Outbox / Delivery (standard + full)

Query `distribution_outbox` table: `pick_id = <pick_id>`.

Report each row:
- `id`
- `target`
- `status` (pending / processing / sent / failed / dead_letter)
- `claimed_at`, `claimed_by`
- `idempotency_key`
- `created_at`

If `status = sent`:
Query `distribution_receipts` table: `pick_id = <pick_id>` (or join via outbox_id if direct link exists).

Report each receipt:
- `id`
- `channel` (e.g. `discord:best-bets`)
- `message_id` (Discord message ID)
- `delivered_at`
- `idempotency_key`

**Check:**
- If `picks.status = posted` but no `sent` outbox row → INCONSISTENT
- If `picks.status = posted` but no receipt → flag as gap (receipt might be missing)
- If `picks.status = queued` but outbox row is `failed` or `dead_letter` → flag as delivery failure
- If `picks.promotion_status != 'qualified'` but outbox row exists → flag as routing gate violation
- `receipt.channel` must match `picks.promotion_target` (with `discord:` prefix)

**Live targets (valid channel values):**
```
discord:canary           → 1296531122234327100
discord:best-bets        → 1288613037539852329
discord:trader-insights  → 1356613995175481405
```

---

### Step 5 — Settlement (standard + full)

Query `settlement_records` table: `pick_id = <pick_id>`, order by `created_at ASC`.

Report each row:
- `id`
- `status` (manual_review / settled / voided)
- `result` (win / loss / push / void)
- `source`
- `corrects_id` (if correction chain)
- `created_at`

**Check:**
- If `picks.status = settled` but no `settlement_records` row → INCONSISTENT
- If `picks.status != settled` and no `settlement_records` row → not yet settled (report clearly)
- If a row has `corrects_id`, trace correction chain (original row must still exist and be immutable)
- If `source = feed` → flag as anomaly (feed settlement is blocked at service layer; should never reach DB)
- Note if any row is `manual_review` and whether it was subsequently corrected

---

### Step 6 — Audit Log (full depth only)

**Important:** `audit_log.entity_id` is NOT the pick_id. Query by `entity_ref = <pick_id>` to get all audit entries for a pick.

Query `audit_log` table: `entity_ref = <pick_id>`, order by `created_at ASC`.

Also gather entity IDs from prior steps:
- promotion history IDs → look for `action = 'promotion.qualified'` / `'promotion.suppressed'`
- outbox ID → look for `action = 'distribution.sent'` / `'distribution.failed'`
- settlement record IDs → look for `action = 'settlement.recorded'`

Report each entry:
- `action`
- `entity_id`
- `entity_ref`
- `actor`
- `created_at`

**Check:**
- Expect `promotion.qualified` or `promotion.suppressed` entries for each policy evaluation
- Expect `distribution.sent` if pick was posted (note: `entity_ref` may be null on distribution.sent — this is normal per Week 11 finding)
- Expect `settlement.recorded` if pick is settled
- Any action without a matching upstream row → flag as orphaned audit entry
- Missing audit entries for claimed transitions → flag as gap

---

### Step 7 — Downstream / Recap (full depth only)

**Operator surface check:**
- Query `GET /api/operator/recap` — confirm pick appears if settled
- Query `GET /api/operator/snapshot` — confirm channel health if pick was distributed

If pick is not settled: state "Not settled — downstream recap not applicable."
If operator surface is not available in this session: mark UNVERIFIED.

**Verification preference order (per CLAUDE.md):**
1. `pnpm verify:pick -- <pick_id>` or direct repo CLI / live DB query ← preferred
2. `GET /api/picks/:id/trace` or operator surface
3. Runtime/API response
4. Worker log ← last resort

---

## Output Format

```
# Pick Verification Report

## Pick
- ID: <uuid>
- Source: <source>
- Market: <market> | Selection: <selection>
- Odds: <odds> | Stake: <stake_units>
- Confidence: <confidence or ABSENT>
- Created: <created_at>

## Current Status
- picks.status: <status>
- Approval: <approval_status>
- Lifecycle chain: validated → [queued →] [posted →] [settled | voided]
- Chain complete: YES / NO / IN-PROGRESS
  - YES = chain ends at a terminal state (settled or voided) with no gaps
  - NO = chain is missing an expected transition or contradicts picks.status
  - IN-PROGRESS = pick is validly mid-lifecycle (e.g. validated, queued, or posted but not yet settled — not a defect)
- Last transition: <from_state> → <to_state> at <timestamp>

## Scoring / Promotion
- promotion_status: <status>
- promotion_target: <target or NULL>
- promotion_score: <score>
- Policy results:
  - best-bets: <qualified/suppressed/not_eligible> (score=X, reason if suppressed)
  - trader-insights: <qualified/suppressed/not_eligible> (score=X, reason if suppressed)
- Promotion history rows: <count> found

## Posting / Delivery
- Outbox rows: <count> found
  - [id]: target=<target>, status=<status>, claimed_at=<ts>
- Receipt rows: <count> found
  - [id]: channel=<channel>, message_id=<discord_id>, delivered_at=<ts>
- Delivery verdict: DELIVERED / PROCESSING / FAILED / PENDING / NOT_ENQUEUED
  - DELIVERED = outbox sent + receipt exists
  - PROCESSING = worker claimed the row, delivery not yet confirmed
  - FAILED = outbox failed or dead_letter
  - PENDING = outbox row exists but unclaimed
  - NOT_ENQUEUED = no outbox row (pick was suppressed or not yet submitted)

## Settlement
- settlement_records rows: <count> found
  - [id]: status=<status>, result=<result>, source=<source>, created_at=<ts>
  - [correction chains if any]
- Settlement verdict: SETTLED / MANUAL_REVIEW / UNSETTLED / INCONSISTENT

## Downstream / Recap
- Recap visible: YES / NO / NOT_APPLICABLE / UNVERIFIED
- Operator snapshot: <note if checked>

## Evidence Found
- picks row: YES / NO
- pick_lifecycle rows: <count>
- pick_promotion_history rows: <count>
- distribution_outbox rows: <count>
- distribution_receipts rows: <count>
- settlement_records rows: <count>
- audit_log entries: <count> (full depth only)

## Gaps / Mismatches
- <List each gap or inconsistency found>
- NONE — if clean

## Verdict
<VERIFIED | PARTIALLY VERIFIED | INCONSISTENT | NOT FOUND | UNVERIFIED>

Reason: <one sentence>
```

---

## Verdict Definitions

| Verdict | Meaning |
|---------|---------|
| `VERIFIED` | All evidence present; lifecycle chain complete; no gaps or contradictions |
| `PARTIALLY VERIFIED` | Core evidence present; minor gaps that are explainable (e.g. pick not yet settled) |
| `INCONSISTENT` | Evidence contradicts claimed state (e.g. `picks.status=posted` but no outbox sent row) |
| `NOT FOUND` | Pick ID not found in `picks` table |
| `UNVERIFIED` | Cannot determine truth from available tooling (e.g. Supabase MCP not available) |

---

## Known V2 Quirks (do not flag as bugs)

1. `distribution.sent` audit log entry has `entity_ref = null` — worker does not write entity_ref on sent events. This is normal.
2. Picks without `confidence` field (Smart Form V1) score 61.5 and are correctly suppressed. Not a bug.
3. `picks.posted_at` and `picks.settled_at` are denormalized caches — application-maintained, not trigger-maintained. May lag slightly.
4. Two `pick_promotion_history` rows per pick is correct (one per policy). Both persist even when only one target wins.
5. `audit_log.entity_id` is never the pick_id — query via `entity_ref = pick_id` to find all audit entries for a pick.
6. `draft` status exists in transition map but is unused — all V2 picks start at `validated`.

---

## Limitations / UNVERIFIED Surfaces

- **Recap/downstream visibility** — operator-web `/api/operator/recap` must be live to verify; mark UNVERIFIED if not accessible
- **Discord message delivery confirmation** — can only be confirmed via `distribution_receipts.message_id`; direct Discord API not queried
- **Worker logs** — not queryable via Supabase MCP; flag as "worker log not checked" if needed
- **Board cap impact** — board state at time of submission not reconstructable from current DB state alone; can only verify current board state
- **Correction depth > 1** — trace correction chains manually if `corrects_id` chains are multi-level

---

## Usage Examples

```
# Quick — just check if pick exists and its current lifecycle status
/verify-pick <pick_uuid>
/verify-pick <pick_uuid> depth=quick

# Standard — full lifecycle + promotion + delivery check (default)
/verify-pick <pick_uuid> depth=standard

# Full — everything including audit log and downstream recap
/verify-pick <pick_uuid> depth=full

# When you only have an external reference
/verify-pick external_ref=<ref_string> depth=standard

# Typical debugging invocations
/verify-pick eb12a6c2-... depth=standard      # "why didn't this pick post?"
/verify-pick eb12a6c2-... depth=full          # T1 sprint proof verification
/verify-pick eb12a6c2-... depth=quick         # sanity check during audit
```
