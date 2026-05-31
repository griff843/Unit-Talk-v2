## Metadata

| Field | Value |
|---|---|
| Issue ID | UTV2-1136 |
| Tier | T1 |
| Phase / Gate | WS-4.2 Settlement Hardening — INIT-4.2.2 |
| Owner | claude/utv2-1136-dispatch-session |
| Date | 2026-05-31 |
| Verifier Identity | claude/sonnet-4-6/session-utv2-1136 |
| Commit SHA(s) | d95a7838a718b0f8efedead66f59480f079472ac |
| Related PRs | #939 |

## Scope

**Claims:**
1. `BEFORE UPDATE OR DELETE` trigger on `public.settlement_records` is live in production DB
2. Any UPDATE on an existing settlement row is rejected with `SETTLEMENT_RECORD_IMMUTABLE` (SQLSTATE P0001)
3. Any DELETE on an existing settlement row is rejected with `SETTLEMENT_RECORD_IMMUTABLE` (SQLSTATE P0001)
4. Correction INSERTs (new rows with `corrects_id` set) pass unaffected — append-only path intact
5. `pnpm verify` and `pnpm test:db` remain green after migration

**Does NOT claim:**
- Any change to application logic (`repositories.ts` was in scope lock but required no modification)
- Any change to pick lifecycle, scoring, or delivery systems
- Pick-level verification (no pick-lifecycle changes in this lane)

## Assertions

| # | Assertion | Result | Evidence |
|---|---|---|---|
| A1 | settlement INSERT succeeds — baseline append-only path intact | PASS | T1 live-DB proof test ok 1 |
| A2 | UPDATE on settlement_records row rejected with SETTLEMENT_RECORD_IMMUTABLE | PASS | T1 live-DB proof test ok 2 |
| A3 | DELETE on settlement_records row rejected with SETTLEMENT_RECORD_IMMUTABLE | PASS | T1 live-DB proof test ok 3 |
| A4 | correction INSERT (corrects_id set) succeeds; both original and correction rows present | PASS | T1 live-DB proof test ok 4 |
| A5 | pnpm verify exits 0 (113 tests pass) | PASS | verify output |
| A6 | pnpm test:db exits 0 (7 tests pass) | PASS | test:db output |
| A7 | R-level check passes — no missing artifacts | PASS | R-level output |
| A8 | Migration applied to live Supabase (project zfzdnfwdarxucxtaojxm) | PASS | MCP apply_migration response |

## Evidence Blocks

### EA1

```text
T1 Live-DB Proof — test ok 1 (settlement INSERT succeeds):
File: apps/api/src/t1-proof-utv2-1136-settlement-records-immutability.test.ts
ok 1 - UTV2-1136: settlement INSERT succeeds (baseline)
duration_ms: 468.016558 / type: test / PASS
```

### EA2

```text
T1 Live-DB Proof — test ok 2 (UPDATE rejected):
ok 2 - UTV2-1136: UPDATE on settlement_records is rejected by immutability trigger
duration_ms: 440.259502 / type: test / PASS
Error confirmed: message includes "SETTLEMENT_RECORD_IMMUTABLE", code "P0001"
```

### EA3

```text
T1 Live-DB Proof — test ok 3 (DELETE rejected):
ok 3 - UTV2-1136: DELETE on settlement_records is rejected by immutability trigger
duration_ms: 422.50464 / type: test / PASS
Error confirmed: message includes "SETTLEMENT_RECORD_IMMUTABLE", code "P0001"
```

### EA4

```text
T1 Live-DB Proof — test ok 4 (correction INSERT passes):
ok 4 - UTV2-1136: correction INSERT (with corrects_id) succeeds — append-only path intact
duration_ms: 535.330502 / type: test / PASS
Verified: correction.corrects_id == original.id; listByPick returns 2 rows.

# tests 4 / pass 4 / fail 0 / duration_ms 2569
```

### EA5

```text
pnpm verify (branch claude/utv2-1136-init-422-settlement-records-immutability-trigger):
sync-check PASS / system-alignment PASS / automation-coverage PASS / env:check PASS
lint PASS / type-check PASS / build PASS
test: 113 pass / 0 fail
verify:commands: 14 commands verified, 116 migrations lint clean
EXIT: 0
```

### EA6

```text
pnpm test:db (apps/api/src/database-smoke.test.ts):
ok 1 - UTV2-879: distinct settlement source enforcement
ok 2 - UTV2-995: corrects_id references same pick
ok 3 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 4 - UTV2-996: correction chain is additive — original settlement row is not mutated
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
# tests 7 / pass 7 / fail 0
```

### EA7

```text
R-level check (scripts/ci/r-level-check.ts --base origin/main --head HEAD):
Verdict: PASS
Changed files: 6
Rules matched: (none) — no R-level artifacts required for this diff
```

### EA8

```text
Migration applied via MCP (mcp__claude_ai_Supabase__apply_migration):
project_id: zfzdnfwdarxucxtaojxm
name: 20260530002_utv2_1136_settlement_records_immutability_trigger
result: {"success":true}

Function: settlement_records_immutable()
Trigger: trg_settlement_records_immutable
Timing: BEFORE UPDATE OR DELETE ON public.settlement_records
Error prefix: SETTLEMENT_RECORD_IMMUTABLE / ERRCODE: P0001
```

## Acceptance Criteria Mapping

| AC from UTV2-1136 PM Constraints | Assertion | Status |
|---|---|---|
| BEFORE UPDATE OR DELETE trigger on settlement_records | A8 | PASS |
| UPDATE rejected | A2 | PASS |
| DELETE rejected | A3 | PASS |
| Correction INSERT still passes | A4 | PASS |
| pnpm test:db passes | A6 | PASS |
| T1 evidence bundle complete | This bundle | DONE |

## Stop Conditions Encountered

None. Worker downtime (pre-existing) caused the automated `pnpm proof:t1` bundler to exit FAIL on pipeline state — not related to this lane. All T1-required verification ran successfully via direct `pnpm verify`, `pnpm test:db`, and the T1 proof test. Evidence is manually assembled per EVIDENCE_BUNDLE_TEMPLATE.md.

## Sign-off

Verifier: claude/sonnet-4-6/session-utv2-1136
Date: 2026-05-31
Result: PASS — all acceptance criteria met; trigger live in production, append-only semantics enforced at DB layer.
Proof artifact: `docs/06_status/proof/UTV2-1136/`
