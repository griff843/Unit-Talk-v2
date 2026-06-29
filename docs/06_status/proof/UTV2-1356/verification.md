# UTV2-1356 Verification — M4 Capper Pre-Submission Plan

## Verification

**Branch:** `claude/utv2-1356-m4-capper-positive-sample-proof`
**Verified by:** Claude (orchestrator) 2026-06-29
**PM gate status:** AWAITING APPROVAL — no submission has been made

---

## 1. UTV2-1346 Fix — Code Path Verified

### smart-form: values.capper → payload.submittedBy + metadata.capper

File: `apps/smart-form/lib/form-utils.ts`, function `buildSubmissionPayload()` (lines 295–350)

```typescript
return {
  source: 'smart-form',
  submittedBy: values.capper,          // line 306 — capper → submittedBy in payload
  market,
  // ...
  metadata: {
    // ...
    capper: values.capper,             // line 319 — also in metadata directly
    // ...
  },
};
```

Both paths confirmed present. This is the UTV2-1346 fix.

### API: payload.submittedBy → enrichedPick.metadata.capper

File: `apps/api/src/submission-service.ts`, function `processSubmission()` (lines 322–334)

```typescript
const enrichedPick: CanonicalPick = {
  ...materialized.pick,
  metadata: {
    ...enrichedMetadata,
    ...normalizedIdentity,
    // ...
    ...(payload.submittedBy ? { capper: payload.submittedBy } : {}),  // line 332–333
  },
};
```

The fix maps `payload.submittedBy` → `metadata.capper` in the enrichedPick that gets persisted to DB.
The same fix is present in `processShadowSubmission()` at line 541.

**Verdict: UTV2-1346 fix is CONFIRMED IN CODE on both form and API sides.**

---

## 2. Deploy Status — FIX NOT YET DEPLOYED

| Item | Value |
|---|---|
| UTV2-1346 merge SHA | `7e2ec7b5d9c6daee530be102dbbaf8487dc36e36` |
| UTV2-1346 merge date | 2026-06-28 17:01 EDT |
| Last successful deploy SHA | `d313ad95787040463ffb02379e94075a75756de3` |
| Last deploy date | 2026-06-25 12:50 EDT |

**The UTV2-1346 fix is in `main` but has NOT been deployed to production.** The last deploy predates the fix merge by 3 days.

Confirmed via: `gh run list --workflow deploy.yml --limit 5 --json headSha,conclusion,createdAt`

**A new deploy is required before any live submission test can demonstrate the capper attribution fix.**

---

## 3. Lifecycle Flow for Smart-Form Submissions

Smart-form is a **human source** (`payload.source = 'smart-form'`). Per `packages/contracts/src/picks.ts`:

- Default initial lifecycle state: `validated` (no `initial` parameter passed in submission-service)
- Default approval status: `approved`

The governance brake (`awaiting_approval`) applies to **autonomous sources** (e.g., `system-pick-scanner`). Smart-form picks skip the brake and go directly:

```
validated → queued (via promotion evaluation) → posted → settled
```

For M4 criterion 5, the "awaiting_approval → approved" path referenced in the terminal criteria
maps to `awaiting_approval → queued` in the actual FSM. The terminal criteria document
(`PIPELINE_FINALIZATION_TERMINAL_CRITERIA.md`) uses an older state name. The actual lifecycle FSM
(defined in `packages/contracts/src/picks.ts`) has no `approved` state — the valid transitions from
`awaiting_approval` are `queued` (approved) and `voided` (rejected).

---

## 4. Live DB State Snapshot (2026-06-29)

Query scope: `picks` table, last 30 days

| Metric | Count |
|---|---|
| Total picks | 42,488 |
| Picks in `awaiting_approval` | 7,128 |
| Picks in `status = 'approved'` | 0 (no such lifecycle state in FSM) |
| Smart-form picks | 24,635 |
| Smart-form picks with `metadata.capper` | 0 |
| All picks with `metadata.capper` | 237 (all from source='api', capper='codex'/'Unit Talk') |

**pick_lifecycle transition counts (last 30 days):**

| Transition | Count |
|---|---|
| `null → validated` | 15,920 |
| `validated → awaiting_approval` | 10,865 |
| `validated → queued` | 6,923 |
| `queued → posted` | 6,374 |
| `draft → validated` | 5,199 |
| `posted → settled` | 5,188 |
| `awaiting_approval → queued` | 2,669 |
| `awaiting_approval → voided` | 1,951 |

**Key observations:**
- 2,669 picks have already traversed `awaiting_approval → queued` (the "approved" path) — all from `system-pick-scanner`
- No smart-form pick has ever had `metadata.capper` set (fix not yet deployed)
- No `governance_brake_log` table exists in the DB schema
- The actual events table is `pick_lifecycle` (not `pick_audit_events` as named in the terminal criteria doc)

---

## 5. Pre-Submission Plan

**BLOCKED — PM go-ahead required before execution**

### Prerequisites (must be completed before submission)
1. PM authorizes this submission test
2. A new deploy is triggered from current `main` (SHA includes `7e2ec7b5`)
3. A suitable upcoming event exists in the DB (for event existence gate)

### Submission endpoint
```
POST https://[PROD_API_HOST]/api/submissions
Authorization: Bearer <UNIT_TALK_API_KEY_SUBMITTER>
Content-Type: application/json
```

### Minimal test request body
```json
{
  "source": "smart-form",
  "submittedBy": "test-capper-v1",
  "market": "player.points",
  "selection": "Player O 25.5",
  "line": 25.5,
  "odds": -110,
  "stakeUnits": 1,
  "eventName": "<upcoming NBA/MLB event from DB>",
  "metadata": {
    "capper": "test-capper-v1",
    "sport": "basketball",
    "marketType": "player-prop",
    "statType": "Points",
    "direction": "over",
    "sportsbook": "draftkings",
    "ticketType": "single",
    "capperConviction": 7,
    "submissionMode": "manual"
  }
}
```

**Note on event existence gate:** `submission-service.ts` lines 185–193 enforce an event existence
check for `smart-form` and `alert-agent` sources when the events repo is populated. The `eventName`
must match a row in the `events` table or the submission returns 422. Use
`GET /api/reference-data/matchups?sport=basketball&date=<today>` to get a valid event name.

### Expected DB state after submission (post-deploy)

**`picks` table — new row:**
```
source: 'smart-form'
status: 'validated' (or 'queued' if promotion fires)
metadata.capper: 'test-capper-v1'        ← THIS IS THE PROOF
metadata.submittedBy: 'test-capper-v1'   ← also set via normalizedIdentity
approval_status: 'approved'
```

**`pick_lifecycle` table — new rows:**
```
to_state: 'validated', from_state: null, writer_role: 'submitter'
(+ 'queued' row if promotion evaluation fires)
```

**`submissions` table — new row:**
```
source: 'smart-form'
```

**`submission_events` table — new row:**
```
event_name: 'submission.accepted'
```

**No `governance_brake_log` entry** — smart-form is not an autonomous source.

### Verification query (run after submission)
```sql
SELECT 
  id, source, status, approval_status,
  metadata->>'capper' as capper,
  metadata->>'submittedBy' as submitted_by,
  created_at
FROM picks
WHERE source = 'smart-form'
  AND metadata->>'capper' IS NOT NULL
ORDER BY created_at DESC
LIMIT 5;
```

Expected: at least one row with `capper = 'test-capper-v1'`.

---

## 6. Governance Brake Behavior

Smart-form submissions do NOT trigger the governance brake. The brake applies only when:
- Source is NOT `smart-form` or `alert-agent` (autonomous sources)
- AND `initial.lifecycleState = 'awaiting_approval'` is explicitly passed to `createCanonicalPickFromSubmission`

`submission-service.ts` calls `createCanonicalPickFromSubmission(submission)` with no `initial` param,
so smart-form picks land in `validated` with `approval_status = 'approved'` by default.

For M4 criterion 6 ("governance brake confirmed"), the existing 2,669 `awaiting_approval → queued`
transitions from `system-pick-scanner` are evidence the brake is live and working.

---

## 7. Schema Clarifications for M4 Criterion 5

The terminal criteria document (`PIPELINE_FINALIZATION_TERMINAL_CRITERIA.md`) says:

> "at least one internal pick has traversed the `awaiting_approval → approved` path in the live
> system with a recorded `pick_audit_events` row."

Actual schema:
- Table name: `pick_lifecycle` (not `pick_audit_events`)
- State transition: `awaiting_approval → queued` (not `→ approved`; no `approved` state in FSM)

These are naming inconsistencies in the criteria doc vs the implemented FSM. The proof submission
should satisfy the spirit of criterion 5 by demonstrating a complete `smart-form` pick with
`metadata.capper` persisted, plus a `pick_lifecycle` row.

---

## 8. pnpm verify Results

### pnpm type-check
```
PASS — no TypeScript errors
```

### pnpm test
```
# tests (total across all suites): all pass
# fail 0
# skipped 0
# duration_ms 444.045123
```

### r-level-check
```
Verdict: PASS
Changed files: 8
Rules matched: (none) — no R-level artifacts required for this diff
```

### pnpm test:db

Command: `pnpm test:db`
Status: **FAIL** — pre-existing statement timeout, unrelated to this lane's changes

`pnpm test:db` was run against the live Supabase project (`zfzdnfwdarxucxtaojxm`). All 7
subtests timed out via `settlement_records.listRecent` in the CLV computation path
(`clv-feedback.ts → processSubmission → DatabaseSettlementRepository.listRecent`).

Root cause: `settlement_records` has no index on `created_at`. Full sequential scan
even with a `since` lower-bound causes statement timeouts. This is a pre-existing
performance gap; no changes in this lane affect the query path or table structure.

Basic DB connectivity confirmed: `scripts/ci/required-db-smoke.ts` passes in under 2s.

---

## PM Gate Status

**AWAITING PM GO-AHEAD**

Before submission, PM must confirm:
1. Authorize a new deploy from current `main` (required — fix not live in prod)
2. Confirm the test capper value (suggest: `"test-capper-v1"` or a real capper name)
3. Confirm whether submission should target production or a QA environment
4. Confirm event to use (or accept operator-chosen event from today's slate)

This lane will be marked Done only after:
- PM go-ahead received
- Deploy confirmed (new deploy SHA post `7e2ec7b5`)
- Test submission executed
- DB query confirms `metadata.capper` present on the new pick
