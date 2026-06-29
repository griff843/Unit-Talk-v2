# UTV2-1357 Verification Log

Issue: UTV2-1357
Tier: T2
Branch: codex/utv2-1357-m4-readiness-rollup
Generated: 2026-06-29T05:30:00Z

## Verification

| Command | Result | Evidence |
| --- | --- | --- |
| `pnpm type-check` | PASS | TypeScript project-reference build completed with exit code 0. |
| `pnpm test` | PASS | All 19 unit tests PASS, 0 fail, 0 skipped (exit code 0). TAP below. |
| `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS | No R-level artifacts required for proof-only diff. |

## pnpm test TAP output

```
# tests 19
# suites 0
# pass 19
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1523.784559
```

## Issue-Specific Evidence

Live DB queries executed via Supabase MCP against project `zfzdnfwdarxucxtaojxm`:

### 1. pick_audit_events table existence
Query: `SELECT id, pick_id, event_type, created_at, metadata FROM pick_audit_events WHERE event_type IN ('awaiting_approval', 'approved') LIMIT 20;`
Result: **ERROR — relation "pick_audit_events" does not exist**
Implication: The table named in M4 criterion 5 does not exist in the live schema. The audit table is `audit_log` (columns: id, entity_type, entity_id, action, actor, payload, created_at, entity_ref) and lifecycle transitions are in `pick_lifecycle`.

### 2. awaiting_approval → approved lifecycle transitions
Query: `SELECT pick_id, from_state, to_state, writer_role, created_at FROM pick_lifecycle WHERE to_state = 'approved' ORDER BY created_at DESC LIMIT 10;`
Result: **0 rows** — No pick has ever transitioned to state `approved`.

### 3. Distinct lifecycle states in pick_lifecycle
Query: `SELECT DISTINCT to_state FROM pick_lifecycle ORDER BY to_state;`
Result: `awaiting_approval, posted, queued, settled, validated, voided`
The `approved` state does not exist as a target state in the live system.

### 4. Active awaiting_approval flow (governance brake working)
Query: `SELECT pick_id, from_state, to_state, writer_role, created_at FROM pick_lifecycle WHERE to_state IN ('awaiting_approval', 'approved', 'qualified') OR from_state = 'awaiting_approval' ORDER BY created_at DESC LIMIT 20;`
Result: Multiple picks flowing `validated → awaiting_approval` via `promoter` (brake is firing). Some advance to `queued` via `operator_override`. None advance to `approved`.

### 5. M3 grading failure rate (current)
Query: `SELECT status, COUNT(*) as count FROM system_runs WHERE run_type = 'grading.run' AND started_at > NOW() - INTERVAL '24 hours' GROUP BY status;`
Result: `failed=33, succeeded=65` → **33.7% failure rate** (threshold: ≤5%)

### 6. Internal evidence-flow audit events
Query: `SELECT id, entity_type, entity_id, action, actor, created_at FROM audit_log WHERE action IN ('awaiting_approval', 'approved', 'internal_selection', 'internal_approval', 'internal_evidence_gate_1', 'internal_evidence_gate_2', 'internal_evidence_gate_3') ORDER BY created_at DESC LIMIT 20;`
Result: **0 rows** — No internal evidence-flow gate events have been recorded.

## R-Level Compliance

```
npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 8
Rules matched: (none) — no R-level artifacts required for this diff
```

## pnpm test:db

Command: `pnpm test:db`
Status: **FAIL** — pre-existing statement timeout, unrelated to this lane's changes

`pnpm test:db` was run against the live Supabase project (`zfzdnfwdarxucxtaojxm`). All 7
subtests timed out via `settlement_records.listRecent` in the CLV computation path
(`clv-feedback.ts → processSubmission → DatabaseSettlementRepository.listRecent`).

Root cause: `settlement_records` has no index on `created_at`. Full sequential scan
even with a `since` lower-bound causes statement timeouts. This is a pre-existing
performance gap; no changes in this lane affect the query path or table structure.

Basic DB connectivity confirmed: `scripts/ci/required-db-smoke.ts` passes in under 2s.

## Merge SHA Binding

Branch: codex/utv2-1357-m4-readiness-rollup
Merge SHA: to be bound by post-merge-lane-close.yml after PR merges
